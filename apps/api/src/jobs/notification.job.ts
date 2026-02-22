/**
 * Notification Job
 * Processes PENDING email notifications from the `notifications` table.
 * Runs every minute via node-cron.
 * Supports:
 *   - report.delivered  → sends PDF attachment
 *   - report.status_changed → plain status email
 *   - assignment.status_changed → plain status email
 */

import { prisma } from '../config/database.js';
import { sendEmail, buildReportDeliveryEmail, buildStatusNotificationEmail } from '../utils/email.js';
import { getFileBuffer } from '../config/storage.js';

const BATCH_SIZE = 10;

export async function processNotifications(): Promise<void> {
  // Fetch a batch of PENDING notifications
  const pending = await prisma.notification.findMany({
    where: { status: 'PENDING', channel: 'EMAIL' },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    include: {
      assignment: {
        select: {
          assignmentNo: true,
          firmReferenceNo: true,
          finalValue: true,
        },
      },
    },
  });

  if (pending.length === 0) return;

  for (const notification of pending) {
    try {
      if (notification.type === 'report.delivered') {
        await handleReportDelivery(notification);
      } else {
        await handleStatusEmail(notification);
      }

      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[notification.job] Failed to send notification ${notification.id}:`, message);

      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED', failureReason: message.slice(0, 1000) },
      });
    }
  }
}

// ─────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────

async function handleReportDelivery(notification: {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  body: string;
  assignmentId: string | null;
  tenantId: string;
  assignment?: {
    assignmentNo: string;
    firmReferenceNo: string;
    finalValue: unknown;
  } | null;
}): Promise<void> {
  // Find the latest generated report for this assignment
  const report = notification.assignmentId
    ? await prisma.report.findFirst({
        where: {
          assignmentId: notification.assignmentId,
          isLatest: true,
          pdfPath: { not: null },
        },
        orderBy: { version: 'desc' },
      })
    : null;

  const recipientName = notification.recipientName ?? 'Sir/Madam';
  const assignmentNo = notification.assignment?.assignmentNo ?? notification.assignmentId ?? '';
  const finalValue = notification.assignment?.finalValue
    ? `₹${Number(notification.assignment.finalValue).toLocaleString('en-IN')}`
    : 'As per report';

  const { subject, html } = buildReportDeliveryEmail({
    recipientName,
    assignmentNo,
    propertyAddress: '', // included in report
    finalValue,
    customMessage: notification.body,
  });

  // Attach PDF if available
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  if (report?.pdfPath) {
    try {
      const pdfBuffer = await getFileBuffer(report.pdfPath);
      attachments.push({
        filename: `ValuationReport_${assignmentNo.replace(/\//g, '-')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch {
      // Log but don't fail — send email without attachment
      console.warn(`[notification.job] Could not fetch PDF for report ${report.id}`);
    }
  }

  await sendEmail({
    to: notification.recipientEmail,
    toName: recipientName,
    subject,
    html,
    attachments,
  });
}

async function handleStatusEmail(notification: {
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  type: string;
  assignment?: {
    assignmentNo: string;
  } | null;
}): Promise<void> {
  const recipientName = notification.recipientName ?? 'Team';
  const assignmentNo = notification.assignment?.assignmentNo ?? '';

  // For status-change notifications, use the formatted HTML template
  const newStatus = notification.body; // body holds the status or message
  const { html } = buildStatusNotificationEmail({
    recipientName,
    assignmentNo,
    newStatus,
  });

  await sendEmail({
    to: notification.recipientEmail,
    toName: recipientName,
    subject: notification.subject,
    html,
  });
}
