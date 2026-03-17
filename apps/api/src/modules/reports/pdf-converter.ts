/**
 * PDF Converter — LibreOffice Headless
 * Converts a DOCX buffer to PDF using LibreOffice's headless CLI.
 * LibreOffice must be installed and accessible at env.LIBREOFFICE_PATH.
 *
 * On production (EC2 Amazon Linux): sudo yum install libreoffice
 * On macOS dev: brew install --cask libreoffice
 * On Ubuntu: sudo apt-get install libreoffice
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.middleware.js';

const execFileAsync = promisify(execFile);

/**
 * Convert a DOCX buffer to PDF using LibreOffice.
 * Returns the PDF as a Buffer.
 * Cleans up all temp files automatically.
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  // Create a temp directory for this conversion job
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vm-report-'));
  const docxPath = path.join(tmpDir, 'report.docx');

  try {
    // Write DOCX to temp file
    await fs.promises.writeFile(docxPath, docxBuffer);

    // Run LibreOffice headless conversion
    // --headless: no GUI, --convert-to pdf: target format, --outdir: output dir
    await execFileAsync(env.LIBREOFFICE_PATH, [
      '--headless',
      '--nofirststartwizard',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      docxPath,
    ], {
      timeout: 60_000,  // 60 second timeout
      env: {
        ...process.env,
        HOME: tmpDir,   // Prevent LibreOffice from writing to system home
        TMPDIR: tmpDir,
      },
    });

    // Read the generated PDF
    const pdfPath = path.join(tmpDir, 'report.pdf');
    const pdfExists = await fs.promises.access(pdfPath).then(() => true).catch(() => false);

    if (!pdfExists) {
      throw new AppError(500, 'LibreOffice conversion failed — PDF file not generated');
    }

    const pdfBuffer = await fs.promises.readFile(pdfPath);
    return pdfBuffer;
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Save a debug copy of the failing DOCX so it can be inspected manually
    const debugPath = `/tmp/failed-report-${Date.now()}.docx`;
    await fs.promises.copyFile(docxPath, debugPath).catch(() => {});
    console.error(`[pdf-converter] DOCX saved for inspection: ${debugPath}`);
    if (message.includes('ENOENT') || message.includes('not found')) {
      throw new AppError(500, `LibreOffice not found at ${env.LIBREOFFICE_PATH}. Install LibreOffice or set LIBREOFFICE_PATH in .env`);
    }
    throw new AppError(500, `PDF conversion failed: ${message}`);
  } finally {
    // Clean up temp directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
