/**
 * DOCX Generator
 * Uses docxtemplater + pizzip to fill processed .docx templates
 * with report data, then optionally inserts images.
 *
 * Template tokens: {fieldName} for text, {%imageToken} for images.
 * Templates must be "processed" (developer one-time task — replace sample
 * data in tables/cells with {token} placeholders).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PizZip = require('pizzip');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Docxtemplater = require('docxtemplater');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageModule = require('docxtemplater-image-module-free');

import type { ReportData } from '@valuemitra/shared';

// Default image dimensions (pixels) per token prefix
function getImageSize(_img: Buffer, tagValue: string): [number, number] {
  if (tagValue.startsWith('propertyPhoto')) return [400, 300];
  if (tagValue === 'locationMap') return [500, 350];
  if (tagValue === 'rrRateScreenshot') return [560, 380];
  if (tagValue.startsWith('onlineRate')) return [560, 380];
  if (tagValue === 'rvSignature') return [180, 70];
  if (tagValue === 'rvStamp') return [120, 120];
  return [300, 200];
}

interface DocxGeneratorOptions {
  /** Raw buffer of the processed .docx template */
  templateBuffer: Buffer;
  /** Flat data object — all {token} placeholders resolved from this */
  data: ReportData;
  /**
   * Optional image buffers keyed by token name.
   * For each entry, the template data must have token = token (value equals key)
   * so that docxtemplater-image-module-free calls getImage(tokenName).
   */
  images?: Record<string, Buffer>;
}

/**
 * Fill a docxtemplater template with report data.
 * Returns the generated DOCX as a Buffer.
 */
export function generateDocx(options: DocxGeneratorOptions): Buffer {
  const { templateBuffer, data, images = {} } = options;

  const zip = new PizZip(templateBuffer);

  // Build the flat data map: Docxtemplater replaces {key} with value
  const templateData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    templateData[key] = value === null || value === undefined ? '' : String(value);
  }

  // For image tokens, ensure the value in templateData equals the token name
  // (so getImage receives the token name as tagValue)
  for (const token of Object.keys(images)) {
    templateData[token] = token;
  }

  const modules: unknown[] = [];

  if (Object.keys(images).length > 0) {
    const imageModule = new ImageModule({
      centered: false,
      fileType: 'docx',
      getImage(tagValue: string): Buffer | null {
        return images[tagValue] ?? null;
      },
      getSize(_img: Buffer, tagValue: string): [number, number] {
        return getImageSize(_img, tagValue);
      },
    });
    modules.push(imageModule);
  }

  const doc = new Docxtemplater(zip, {
    modules,
    paragraphLoop: true,
    linebreaks: true,
    // Null handling: replace missing tags with empty string
    nullGetter: () => '',
  });

  try {
    doc.render(templateData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = (err as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;
    const tagName = detail?.id ?? detail?.xtag ?? '';
    throw new Error(`Template rendering failed${tagName ? ` at tag {${String(tagName)}}` : ''}: ${msg}`);
  }

  const buf: Buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }) as Buffer;

  return buf;
}
