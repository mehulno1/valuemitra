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

import type { ReportData } from '@valuemitra/shared';

interface DocxGeneratorOptions {
  /** Raw buffer of the processed .docx template */
  templateBuffer: Buffer;
  /** Flat data object — all {token} placeholders resolved from this */
  data: ReportData;
}

/**
 * Fill a docxtemplater template with report data.
 * Returns the generated DOCX as a Buffer.
 */
export function generateDocx(options: DocxGeneratorOptions): Buffer {
  const { templateBuffer, data } = options;

  const zip = new PizZip(templateBuffer);

  // Build the flat data map: Docxtemplater replaces {key} with value
  // We spread the ReportData directly — all values must be strings or undefined
  // undefined values are replaced with empty string to avoid {undefined} in output
  const templateData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    templateData[key] = value === null || value === undefined ? '' : String(value);
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Null handling: replace missing tags with empty string
    nullGetter: () => '',
  });

  doc.render(templateData);

  const buf: Buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }) as Buffer;

  return buf;
}
