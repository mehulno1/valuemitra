// Fill a compiled template with data. Values come from the case resolver; images (signature, seal,
// letterhead, photos, pages) are passed by key so the docx keeps exact sizes.
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import PizZip from 'pizzip';
import sharp from 'sharp';
import { CLOSE, HEADER_XML, OPEN } from './compile.js';
import { openDocx, saveDocx, unfloatTables } from './docx.js';

export interface RenderImage {
  buffer: Buffer;
  width: number;  // px at 96 dpi in the document
  height: number;
}

export type RenderData = Record<string, unknown>;

export function renderDocx(compiled: Buffer, data: RenderData, images: Map<string, RenderImage>): Buffer {
  const imageModule = new (ImageModule as any)({
    centered: false,
    fileType: 'docx',
    getImage: (key: string) => {
      const img = images.get(key);
      if (!img) throw new Error(`Image ${key} missing`);
      return img.buffer;
    },
    getSize: (_img: Buffer, key: string) => {
      const img = images.get(key)!;
      return [img.width, img.height];
    },
  });
  const zip = new PizZip(unfloat(compiled));
  upgradeHeaders(zip);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: OPEN, end: CLOSE },
    paragraphLoop: true,
    linebreaks: true,
    modules: [imageModule],
    nullGetter: () => '',
    parser: (tagName: string) => ({
      get: (scope: any) => (tagName === '.' ? scope : scope?.[tagName]),
    }),
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

/** Formats compiled before 28 Oct 2026 may keep the bank's floating tables (see unfloatTables). */
function unfloat(compiled: Buffer): Buffer {
  const parts = openDocx(compiled);
  return unfloatTables(parts.doc) ? saveDocx(parts) : compiled;
}

/** Templates compiled before 22 Oct 2026 carry a header that Word refuses (a centred letterhead image
 *  nested a paragraph inside a run) and an empty cover-page header; swap in the current header. */
function upgradeHeaders(zip: PizZip) {
  if (!zip.file('word/header900.xml')?.asText().includes(`${OPEN}%%LETTERHEAD${CLOSE}`)) return;
  for (const name of Object.keys(zip.files).filter((n) => /^word\/header9\d+\.xml$/.test(n))) zip.file(name, HEADER_XML);
}

/** Fit an image into a box (px), keeping aspect ratio; re-encode as JPEG/PNG of sensible size. */
export async function fitImage(buf: Buffer, boxW: number, boxH: number, opts: { png?: boolean } = {}): Promise<RenderImage> {
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const w0 = (meta.autoOrient?.width ?? meta.width) || boxW;
  const h0 = (meta.autoOrient?.height ?? meta.height) || boxH;
  const scale = Math.min(boxW / w0, boxH / h0, 1e9);
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));
  // store at 2x the displayed size for print sharpness
  const resized = img.resize({ width: Math.min(w0, width * 2), withoutEnlargement: true });
  const buffer = opts.png ? await resized.png().toBuffer() : await resized.jpeg({ quality: 80 }).toBuffer();
  return { buffer, width, height };
}
