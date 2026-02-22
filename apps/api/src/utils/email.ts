/**
 * Email Service — AWS SES via SMTP (nodemailer)
 * All outbound emails go through this module.
 * Attachments (report PDFs) are supported.
 */

import nodemailer from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer/index.js';
import { env } from '../config/env.js';

// ─────────────────────────────────────────────
// Transporter (lazy singleton)
// ─────────────────────────────────────────────

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: env.SES_SMTP_HOST,
    port: env.SES_SMTP_PORT,
    secure: false,          // STARTTLS on port 587
    requireTLS: true,
    auth: env.SES_SMTP_USER && env.SES_SMTP_PASS
      ? { user: env.SES_SMTP_USER, pass: env.SES_SMTP_PASS }
      : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });

  return _transporter;
}

// ─────────────────────────────────────────────
// Send Email
// ─────────────────────────────────────────────

export interface SendEmailOptions {
  to: string | string[];
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Attachment[];
  replyTo?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const transporter = getTransporter();

  const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
  const toHeader = options.toName
    ? `"${options.toName}" <${toAddresses[0]}>`
    : toAddresses.join(', ');

  const bccAddresses = env.EMAIL_BCC ? [env.EMAIL_BCC] : [];

  await transporter.sendMail({
    from: `"${env.EMAIL_SENDER_NAME}" <${env.EMAIL_SENDER}>`,
    to: toHeader,
    bcc: bccAddresses.join(', ') || undefined,
    subject: options.subject,
    html: options.html,
    text: options.text ?? options.html.replace(/<[^>]*>/g, ''),
    replyTo: options.replyTo,
    attachments: options.attachments,
  });
}

// ─────────────────────────────────────────────
// Email templates (HTML bodies)
// ─────────────────────────────────────────────

export function buildReportDeliveryEmail(params: {
  recipientName: string;
  assignmentNo: string;
  propertyAddress: string;
  finalValue: string;
  customMessage?: string;
}): { subject: string; html: string } {
  const subject = `Valuation Report — ${params.assignmentNo}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f9;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#1a3a6c;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">ValueMitra</h1>
      <p style="color:#a8c4e0;margin:4px 0 0;font-size:13px;">Registered Valuers Platform</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;font-size:15px;">Dear ${params.recipientName},</p>
      <p style="color:#555;font-size:14px;line-height:1.6;">
        ${params.customMessage ?? 'Please find the attached property valuation report prepared in accordance with IBBI (Insolvency and Bankruptcy Board of India) standards.'}
      </p>
      <div style="background:#f0f4fa;border-left:4px solid #1a3a6c;border-radius:4px;padding:16px 20px;margin:24px 0;">
        <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Report Details</p>
        <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#666;width:140px;">Reference No.</td><td style="padding:4px 0;font-weight:600;">${params.assignmentNo}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Property</td><td style="padding:4px 0;">${params.propertyAddress}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Assessed Value</td><td style="padding:4px 0;font-weight:600;color:#1a3a6c;">${params.finalValue}</td></tr>
        </table>
      </div>
      <p style="color:#555;font-size:13px;line-height:1.6;">
        The PDF report is attached to this email. Please review and retain it for your records.
      </p>
      <p style="color:#555;font-size:13px;line-height:1.6;">
        For any queries, please contact us by replying to this email.
      </p>
      <p style="color:#333;font-size:14px;margin-top:32px;">
        Regards,<br>
        <strong>${env.EMAIL_SENDER_NAME} Team</strong>
      </p>
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #eee;">
      <p style="color:#999;font-size:11px;margin:0;line-height:1.5;">
        This is an automated email from ${env.EMAIL_SENDER_NAME}. This valuation report has been prepared by a Registered Valuer in accordance with IBBI (Registered Valuers and Valuation) Rules, 2017. The report is confidential and intended solely for the addressee.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

export function buildStatusNotificationEmail(params: {
  recipientName: string;
  assignmentNo: string;
  newStatus: string;
  notes?: string;
}): { subject: string; html: string } {
  const subject = `Assignment Update — ${params.assignmentNo}`;
  const statusLabel = params.newStatus.replace(/_/g, ' ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9f9f9;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#1a3a6c;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">ValueMitra</h1>
    </div>
    <div style="padding:32px;">
      <p style="color:#333;font-size:15px;">Dear ${params.recipientName},</p>
      <p style="color:#555;font-size:14px;line-height:1.6;">
        The status of assignment <strong>${params.assignmentNo}</strong> has been updated to:
      </p>
      <div style="background:#f0f4fa;border-radius:4px;padding:16px 20px;margin:16px 0;text-align:center;">
        <span style="font-size:18px;font-weight:700;color:#1a3a6c;">${statusLabel}</span>
      </div>
      ${params.notes ? `<p style="color:#555;font-size:14px;"><strong>Notes:</strong> ${params.notes}</p>` : ''}
      <p style="color:#333;font-size:14px;margin-top:32px;">Regards,<br><strong>${env.EMAIL_SENDER_NAME} Team</strong></p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
