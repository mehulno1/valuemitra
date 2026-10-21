// Outgoing email over SMTP (reports, invoices). Attachments are buffers.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';

export async function sendMail(m: { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!env.SMTP_HOST || !env.EMAIL_FROM) throw badRequest('Email is not configured');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT ?? 587, secure: (env.SMTP_PORT ?? 587) === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  try {
    await transport.sendMail({ from: { name: env.EMAIL_FROM_NAME ?? 'ValueMitra', address: env.EMAIL_FROM }, to: m.to, subject: m.subject, text: m.text, attachments: m.attachments });
  } catch (e) {
    // the mail server's reason (e.g. sender not verified) is what the person needs to see
    throw badRequest(`Email could not be sent: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}
