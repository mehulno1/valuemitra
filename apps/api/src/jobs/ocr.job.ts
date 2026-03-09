import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { getFileBuffer } from '../config/storage.js';
import { saveOcrResult, markOcrFailed } from '../modules/documents/documents.service.js';
import { env } from '../config/env.js';
import { OCRStatus, JobStatus, JobType } from '@valuemitra/shared';

const WORKER_ID = env.WORKER_ID;
const BATCH_SIZE = 5;
const LOCK_TIMEOUT_MINUTES = 10;

// ─────────────────────────────────────────────
// Google Cloud Vision — service account JWT auth
// Uses jsonwebtoken (already installed) — no extra SDK needed
// ─────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedGoogleToken: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 60s buffer)
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > now + 60) {
    return cachedGoogleToken.token;
  }

  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');

  const raw = await fs.promises.readFile(credPath, 'utf-8');
  const creds = JSON.parse(raw) as ServiceAccount;

  const claim = {
    iss: creds.client_email,
    sub: creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-vision',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const assertion = (jwt as typeof jwt).sign(claim, creds.private_key, { algorithm: 'RS256' });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google OAuth failed: ${err}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  cachedGoogleToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

// ─────────────────────────────────────────────
// Call Google Cloud Vision DOCUMENT_TEXT_DETECTION
// images:annotate  — for images (PNG, JPEG, WEBP, etc.)
// files:annotate   — for PDFs and TIFFs (inline, up to 5 pages synchronously)
// ─────────────────────────────────────────────

interface VisionPageAnnotation {
  fullTextAnnotation?: {
    text: string;
    pages?: Array<{
      blocks?: Array<{
        paragraphs?: Array<{
          words?: Array<{
            symbols?: Array<{ text: string; confidence?: number }>;
          }>;
        }>;
      }>;
    }>;
  };
  error?: { message: string };
}

interface VisionResponse {
  responses: Array<VisionPageAnnotation>;
}

// Response shape from files:annotate (one outer response per request, pages nested inside)
interface VisionFilesResponse {
  responses: Array<{
    responses?: Array<VisionPageAnnotation>;
    error?: { message: string };
  }>;
}

function extractTextAndConfidence(annotations: VisionPageAnnotation[]): { text: string; confidence: number } {
  const textParts: string[] = [];
  const symbols: number[] = [];

  for (const annotation of annotations) {
    if (annotation.fullTextAnnotation?.text) {
      textParts.push(annotation.fullTextAnnotation.text);
    }
    annotation.fullTextAnnotation?.pages?.forEach(page =>
      page.blocks?.forEach(block =>
        block.paragraphs?.forEach(para =>
          para.words?.forEach(word =>
            word.symbols?.forEach(sym => {
              if (sym.confidence !== undefined) symbols.push(sym.confidence);
            }),
          ),
        ),
      ),
    );
  }

  const text = textParts.join('\n\n');
  const confidence = symbols.length ? symbols.reduce((a, b) => a + b, 0) / symbols.length : 0;
  return { text, confidence };
}

async function runGoogleVision(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; confidence: number; raw: VisionResponse | VisionFilesResponse }> {
  const accessToken = await getGoogleAccessToken();
  const base64 = buffer.toString('base64');

  const isPdf = mimeType === 'application/pdf' || mimeType === 'image/tiff';

  if (isPdf) {
    // PDFs must use files:annotate with inputConfig (not images:annotate)
    // Supports up to 5 pages inline synchronously.
    const body = {
      requests: [
        {
          inputConfig: { content: base64, mimeType },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['en', 'hi'] },
          // pages array omitted → Vision processes all pages (up to 5 for inline)
        },
      ],
    };

    const resp = await fetch('https://vision.googleapis.com/v1/files:annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Vision files:annotate error: ${err}`);
    }

    const data = await resp.json() as VisionFilesResponse;
    const outerResponse = data.responses[0];

    if (outerResponse?.error) {
      throw new Error(`Vision files:annotate returned error: ${outerResponse.error.message}`);
    }

    const pageAnnotations = outerResponse?.responses ?? [];
    const firstError = pageAnnotations.find(r => r.error);
    if (firstError?.error) {
      throw new Error(`Vision page error: ${firstError.error.message}`);
    }

    const { text, confidence } = extractTextAndConfidence(pageAnnotations);
    return { text, confidence, raw: data };

  } else {
    // Images: use images:annotate
    const body = {
      requests: [
        {
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['en', 'hi'] },
        },
      ],
    };

    const resp = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Vision images:annotate error: ${err}`);
    }

    const data = await resp.json() as VisionResponse;
    const response = data.responses[0];

    if (response?.error) {
      throw new Error(`Vision images:annotate returned error: ${response.error.message}`);
    }

    const { text, confidence } = extractTextAndConfidence(response ? [response] : []);
    return { text, confidence, raw: data };
  }
}

// ─────────────────────────────────────────────
// Azure Form Recognizer — prebuilt-read model
// ─────────────────────────────────────────────

interface AzureAnalyzeResult {
  analyzeResult?: {
    content?: string;
    confidence?: number;
  };
  error?: { message: string };
}

async function runAzureFormRecognizer(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; confidence: number; raw: AzureAnalyzeResult }> {
  const endpoint = env.AZURE_FORM_RECOGNIZER_ENDPOINT;
  const key = env.AZURE_FORM_RECOGNIZER_KEY;

  if (!endpoint || !key) throw new Error('Azure Form Recognizer not configured');

  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31`;

  const resp = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'Ocp-Apim-Subscription-Key': key,
    },
    body: buffer,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Azure Form Recognizer error: ${err}`);
  }

  // Azure returns 202 with Operation-Location header for async processing
  const operationUrl = resp.headers.get('Operation-Location');
  if (!operationUrl) throw new Error('Azure did not return Operation-Location');

  // Poll until done (max 30 attempts × 2s = 60s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const pollResp = await fetch(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });

    if (!pollResp.ok) {
      throw new Error(`Azure polling error: ${await pollResp.text()}`);
    }

    const result = await pollResp.json() as { status: string } & AzureAnalyzeResult;

    if (result.status === 'succeeded') {
      const text = result.analyzeResult?.content ?? '';
      const confidence = result.analyzeResult?.confidence ?? 0;
      return { text, confidence, raw: result };
    }

    if (result.status === 'failed') {
      throw new Error(`Azure analysis failed: ${result.error?.message ?? 'unknown'}`);
    }

    // still running — continue polling
  }

  throw new Error('Azure Form Recognizer timed out after 60s');
}

// ─────────────────────────────────────────────
// Extract structured fields from raw OCR text
// Covers the most common Indian property document patterns
// Claude AI (Stage 6) will do deeper extraction — this is a first pass
// ─────────────────────────────────────────────

interface ExtractedFields {
  ownerNames?: string[];
  surveyNo?: string;
  propertyArea?: number;
  propertyAreaUnit?: string;
  registrationNumber?: string;
  registrationDate?: string;
  considerationAmount?: number;
  propertyAddress?: string;
  rawFields?: Record<string, string>;
}

function extractFields(text: string): ExtractedFields {
  const result: ExtractedFields = {};

  // Owner / Vendor / Purchaser names
  const ownerPatterns = [
    /(?:owner|proprietor|in favour of|purchaser|vendee)[:\s]+([A-Z][a-zA-Z\s]{3,60})/gi,
    /(?:shri|smt|mr|mrs|dr)\.?\s+([A-Z][a-zA-Z\s]{2,50})/gi,
  ];
  const names: string[] = [];
  for (const pat of ownerPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const name = m[1]?.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  if (names.length > 0) result.ownerNames = names.slice(0, 5);

  // Survey / CTS / Plot number
  const surveyMatch =
    /(?:survey\s*no\.?|s\.no\.?|cts\s*no\.?|plot\s*no\.?)[:\s#]+([A-Z0-9\/\-]+)/i.exec(text);
  if (surveyMatch?.[1]) result.surveyNo = surveyMatch[1].trim();

  // Area in sq.mt / sq.ft / sq.m
  const areaMatch =
    /(\d[\d,\.]+)\s*(?:sq\.?\s*(?:mt|mtr|m|ft|feet|meter|metres?))/i.exec(text);
  if (areaMatch?.[1]) {
    result.propertyArea = parseFloat(areaMatch[1].replace(/,/g, ''));
    const unitRaw = areaMatch[0].toLowerCase();
    result.propertyAreaUnit = unitRaw.includes('ft') || unitRaw.includes('feet') ? 'sqft' : 'sqm';
  }

  // Registration number
  const regNoMatch =
    /(?:reg(?:istration)?\.?\s*no\.?|document\s*no\.?)[:\s]+([A-Z0-9\/\-]+)/i.exec(text);
  if (regNoMatch?.[1]) result.registrationNumber = regNoMatch[1].trim();

  // Registration date
  const dateMatch =
    /(?:registered on|date of registration|reg(?:istration)?\.?\s*date)[:\s]+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i.exec(
      text,
    );
  if (dateMatch?.[1]) result.registrationDate = dateMatch[1].trim();

  // Consideration / sale amount
  const amountMatch =
    /(?:consideration|sale consideration|total consideration|amount)[:\s]+(?:rs\.?|inr|₹)?\s*([\d,]+)/i.exec(
      text,
    );
  if (amountMatch?.[1]) {
    result.considerationAmount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
  }

  // Property address (first long line containing common address keywords)
  const addressMatch =
    /(?:situated at|located at|property at|premises at)[:\s]+([\w\s,\/\-\.]{10,200})/i.exec(text);
  if (addressMatch?.[1]) result.propertyAddress = addressMatch[1].trim().replace(/\s+/g, ' ');

  return result;
}

// ─────────────────────────────────────────────
// Main OCR processor — called by scheduler
// ─────────────────────────────────────────────

export async function processOcrJobs(): Promise<void> {
  // Release stale locks (jobs locked longer than LOCK_TIMEOUT_MINUTES by crashed workers)
  const staleCutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000);
  await prisma.jobQueue.updateMany({
    where: {
      jobType: JobType.OCR_PROCESSING,
      status: JobStatus.LOCKED,
      lockedAt: { lt: staleCutoff },
    },
    data: { status: JobStatus.PENDING, lockedAt: null, lockedBy: null },
  });

  // Fetch a batch of pending jobs
  const jobs = await prisma.jobQueue.findMany({
    where: {
      jobType: JobType.OCR_PROCESSING,
      status: JobStatus.PENDING,
      scheduledAt: { lte: new Date() },
      attempts: { lt: 3 },
    },
    orderBy: [{ priority: 'asc' }, { scheduledAt: 'asc' }],
    take: BATCH_SIZE,
  });

  if (jobs.length === 0) return;

  // Lock all fetched jobs atomically
  const jobIds = jobs.map(j => j.id);
  await prisma.jobQueue.updateMany({
    where: { id: { in: jobIds }, status: JobStatus.PENDING },
    data: { status: JobStatus.LOCKED, lockedAt: new Date(), lockedBy: WORKER_ID },
  });

  // Process each job
  await Promise.allSettled(jobs.map(job => processSingleOcrJob(job.id, job.payload as { documentId: string })));
}

async function processSingleOcrJob(
  jobId: string,
  payload: { documentId: string },
): Promise<void> {
  const { documentId } = payload;

  // Mark document as processing
  await prisma.document.update({
    where: { id: documentId },
    data: { ocrStatus: OCRStatus.PROCESSING, ocrJobId: jobId },
  });

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, storagePath: true, mimeType: true, documentType: true },
    });

    if (!document) {
      await failJob(jobId, documentId, 'Document not found in DB');
      return;
    }

    // Retrieve file buffer from storage
    const buffer = await getFileBuffer(document.storagePath);

    // Try Google Vision first, fallback to Azure
    let text = '';
    let confidence = 0;
    let provider = '';
    let rawResponse: Record<string, unknown> = {};

    // Google Vision inline API limit is 20 MB for the base64 payload.
    // Base64 adds ~33% overhead, so skip Vision for buffers > 14 MB.
    const VISION_MAX_BYTES = 14 * 1024 * 1024;
    if (env.GOOGLE_APPLICATION_CREDENTIALS && buffer.length <= VISION_MAX_BYTES) {
      try {
        const result = await runGoogleVision(buffer, document.mimeType);
        text = result.text;
        confidence = result.confidence;
        provider = 'google_vision';
        rawResponse = result.raw as unknown as Record<string, unknown>;
      } catch (err) {
        console.warn(`Google Vision failed for ${documentId}, trying Azure:`, err);
      }
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS && buffer.length > VISION_MAX_BYTES) {
      console.info(`Document ${documentId} is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — too large for Vision inline API, trying Azure`);
    }

    if (!provider && env.AZURE_FORM_RECOGNIZER_ENDPOINT && env.AZURE_FORM_RECOGNIZER_KEY) {
      try {
        const result = await runAzureFormRecognizer(buffer, document.mimeType);
        text = result.text;
        confidence = result.confidence;
        provider = 'azure_form_recognizer';
        rawResponse = result.raw as unknown as Record<string, unknown>;
      } catch (err) {
        console.warn(`Azure Form Recognizer failed for ${documentId}:`, err);
      }
    }

    if (!provider) {
      // Neither OCR provider available — mark as skipped (not a failure)
      await saveOcrResult(documentId, {
        status: OCRStatus.SKIPPED,
        provider: 'none',
        rawResponse: {},
        extracted: {},
        confidence: 0,
      });
      await completeJob(jobId);
      return;
    }

    // Extract structured fields from text
    const extracted = extractFields(text);

    // Mark as NEEDS_REVIEW if confidence is low, COMPLETED otherwise
    const ocrStatus = confidence < 0.7 ? OCRStatus.NEEDS_REVIEW : OCRStatus.COMPLETED;

    await saveOcrResult(documentId, {
      status: ocrStatus,
      provider,
      rawResponse: { fullText: text },   // store only extracted text — raw provider JSON is too large for MySQL max_allowed_packet
      extracted: extracted as unknown as Record<string, unknown>,
      confidence,
    });

    await completeJob(jobId);
    console.info(`OCR completed for document ${documentId} via ${provider} (confidence: ${(confidence * 100).toFixed(1)}%)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, documentId, message);
  }
}

async function completeJob(jobId: string): Promise<void> {
  await prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
    },
  });
}

async function failJob(jobId: string, documentId: string, reason: string): Promise<void> {
  const job = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true, failureLog: true },
  });

  if (!job) return;

  const newAttempts = job.attempts + 1;
  const failureLog = ((job.failureLog as unknown as Array<{ attempt: number; reason: string; at: string }>) ?? []).concat({
    attempt: newAttempts,
    reason,
    at: new Date().toISOString(),
  });

  const isFinal = newAttempts >= job.maxAttempts;

  await prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: isFinal ? JobStatus.FAILED : JobStatus.PENDING,
      attempts: newAttempts,
      lockedAt: null,
      lockedBy: null,
      failureLog: failureLog as unknown as object,
      // Exponential back-off: retry after 2^attempts minutes
      scheduledAt: isFinal ? undefined : new Date(Date.now() + Math.pow(2, newAttempts) * 60 * 1000),
    },
  });

  if (isFinal) {
    await markOcrFailed(documentId, reason);
  }

  console.error(`OCR job ${jobId} failed (attempt ${newAttempts}/${job.maxAttempts}): ${reason}`);
}

// ─────────────────────────────────────────────
// Cache cleanup — remove expired cache entries
// ─────────────────────────────────────────────

export async function cleanupExpiredCache(): Promise<void> {
  const result = await prisma.cacheEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    console.info(`Cache cleanup: removed ${result.count} expired entries`);
  }
}
