// OCR adapter: Google Cloud Vision DOCUMENT_TEXT_DETECTION on page images. Language hints cover
// English, Marathi, Hindi and Gujarati. Swappable: anything returning OcrPage works.
import { GoogleAuth } from 'google-auth-library';
import { env } from '../config/env.js';

export interface OcrPage {
  text: string;
  confidence: number | null;
  languages: string[];
  words?: { text: string; box: [number, number, number, number] }[];
}

let auth: GoogleAuth | null = null;
const client = () => {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('OCR is not configured (GOOGLE_APPLICATION_CREDENTIALS)');
  auth ??= new GoogleAuth({ keyFile: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-vision'] });
  return auth;
};

/** OCR up to 16 images in one request. */
export async function ocrImages(images: Buffer[]): Promise<OcrPage[]> {
  const out: OcrPage[] = [];
  for (let i = 0; i < images.length; i += 16) {
    const batch = images.slice(i, i + 16);
    const res = await client().request<any>({
      url: 'https://vision.googleapis.com/v1/images:annotate',
      method: 'POST',
      data: {
        requests: batch.map((b) => ({
          image: { content: b.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['en', 'mr', 'hi', 'gu'] },
        })),
      },
      timeout: 120_000,
    });
    for (const r of res.data.responses ?? []) {
      if (r.error) throw new Error(`Vision: ${r.error.message}`);
      const full = r.fullTextAnnotation;
      const pages = full?.pages ?? [];
      const confs = pages.flatMap((p: any) => (p.blocks ?? []).map((b: any) => b.confidence)).filter((c: any) => typeof c === 'number');
      const langs = new Set<string>();
      for (const p of pages) for (const l of p.property?.detectedLanguages ?? []) if ((l.confidence ?? 0) > 0.2) langs.add(l.languageCode);
      out.push({
        text: full?.text ?? '',
        confidence: confs.length ? confs.reduce((a: number, b: number) => a + b, 0) / confs.length : null,
        languages: [...langs],
      });
    }
  }
  return out;
}

export const LANG_NAME: Record<string, string> = { en: 'English', mr: 'Marathi', hi: 'Hindi', gu: 'Gujarati' };
