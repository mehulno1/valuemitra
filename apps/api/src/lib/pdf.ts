import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { env } from '../config/env.js';

const run = promisify(execFile);

async function tmpDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `vm-${prefix}-`));
}

/** Word → PDF with LibreOffice headless. A private profile dir per call avoids lock conflicts. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const dir = await tmpDir('pdf');
  try {
    const input = path.join(dir, 'report.docx');
    await fs.writeFile(input, docx);
    await run(env.SOFFICE_PATH, [
      `-env:UserInstallation=file://${path.join(dir, 'profile')}`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input,
    ], { timeout: 120_000, env: { ...process.env, HOME: dir } });
    return await fs.readFile(path.join(dir, 'report.pdf'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Rasterise PDF pages to JPEG (for page thumbnails, OCR of scans and the documents annexure). */
export async function pdfToImages(pdf: Buffer, opts: { dpi?: number; first?: number; last?: number } = {}): Promise<Buffer[]> {
  const dir = await tmpDir('ppm');
  try {
    const input = path.join(dir, 'in.pdf');
    await fs.writeFile(input, pdf);
    const args = ['-jpeg', '-jpegopt', 'quality=82', '-r', String(opts.dpi ?? 110)];
    if (opts.first) args.push('-f', String(opts.first));
    if (opts.last) args.push('-l', String(opts.last));
    await run(env.PDFTOPPM_PATH, [...args, input, path.join(dir, 'pg')], { timeout: 180_000, maxBuffer: 1 << 26 });
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('pg') && f.endsWith('.jpg')).sort();
    return Promise.all(files.map((f) => fs.readFile(path.join(dir, f))));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const d = await PDFDocument.load(pdf, { ignoreEncryption: true });
  return d.getPageCount();
}

/** Split out a set of 1-based pages into a new PDF. */
export async function extractPages(pdf: Buffer, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/** Diagonal DRAFT watermark on every page (drafts shared with the bank). */
export async function watermark(pdf: Buffer, text = 'DRAFT'): Promise<Buffer> {
  const d = await PDFDocument.load(pdf);
  const font = await d.embedFont(StandardFonts.HelveticaBold);
  for (const page of d.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 4.2;
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - (w / 2) * Math.cos(Math.PI / 6),
      y: height / 2 - (w / 2) * Math.sin(Math.PI / 6),
      size, font, color: rgb(0.26, 0.22, 0.66), opacity: 0.08, rotate: degrees(30),
    });
  }
  return Buffer.from(await d.save());
}
