import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

// ─────────────────────────────────────────────
// Audit logging utility — used by service layer
// Audit logs are NEVER deleted (IBBI compliance)
// ─────────────────────────────────────────────

export async function createAuditLog(params: {
  tenantId: string;
  userId?: string;
  action: string;           // e.g. "assignment.status_changed"
  entityType: string;       // e.g. "Assignment"
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before as object ?? undefined,
        after: params.after as object ?? undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (err) {
    // Audit log failure should not break the main operation
    // but should always be logged
    console.error('Audit log creation failed:', err);
  }
}

// Express middleware for automatic request audit logging on mutations
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.json.bind(res);

  res.json = function (body: unknown) {
    // Log write operations (non-GET, successful responses)
    if (req.method !== 'GET' && res.statusCode < 400 && req.user && req.tenant) {
      // Let service layer handle detailed audit logging
      // This middleware handles generic request logging
      void createAuditLog({
        tenantId: req.tenant.id,
        userId: req.user.id,
        action: `http.${req.method.toLowerCase()}`,
        entityType: 'HttpRequest',
        entityId: req.path,
        after: { method: req.method, path: req.path, statusCode: res.statusCode },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return originalSend(body);
  };

  next();
}
