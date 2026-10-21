// Detect a file's real type from its first bytes; uploads are accepted by content, never by the
// name or the browser-supplied MIME type.
import { badRequest } from './errors.js';

export type Kind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic' | 'docx' | 'unknown';

export function sniff(buf: Buffer): Kind {
  if (buf.length < 12) return 'unknown';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /heic|heix|mif1|msf1/.test(buf.subarray(8, 12).toString('latin1'))) return 'heic';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('[Content_Types].xml')) && buf.includes(Buffer.from('word/'))) return 'docx';
  return 'unknown';
}

const MIME: Record<Kind, string> = {
  pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', unknown: 'application/octet-stream',
};

/** Returns the trusted MIME type, or throws if the content is not one of the allowed kinds. */
export function requireKind(buf: Buffer, allowed: Kind[], name: string): string {
  const k = sniff(buf);
  if (k === 'heic' && !allowed.includes(k)) throw badRequest(`${name}: HEIC photos are not supported yet; share them as JPEG (most phones do this when sending on WhatsApp)`);
  if (!allowed.includes(k)) throw badRequest(`${name}: allowed types are ${allowed.join(', ').toUpperCase()}`);
  return MIME[k];
}

// HEIC is detected but not accepted: the image library cannot decode it. Phones can share as JPEG.
export const IMAGES: Kind[] = ['jpeg', 'png', 'webp'];
export const DOCS: Kind[] = ['pdf', ...IMAGES];
