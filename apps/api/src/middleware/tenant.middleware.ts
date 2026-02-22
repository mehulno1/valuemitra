import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';

// ─────────────────────────────────────────────
// CRITICAL: Tenant isolation middleware
// Attaches tenant to request and verifies the authenticated user
// belongs to an active tenant. ALL service-layer queries must
// scope by req.tenant.id — this is the multi-tenancy security boundary.
// ─────────────────────────────────────────────

export async function resolveTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    return next(new UnauthorizedError());
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: {
        id: true,
        name: true,
        firmCode: true,
        planId: true,
        isActive: true,
        planExpiresAt: true,
      },
    });

    if (!tenant) {
      return next(new UnauthorizedError('Tenant not found'));
    }

    if (!tenant.isActive) {
      return next(new ForbiddenError('Your account has been suspended. Please contact support.'));
    }

    if (tenant.planExpiresAt && tenant.planExpiresAt < new Date()) {
      return next(new ForbiddenError('Your subscription has expired. Please renew to continue.'));
    }

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      firmCode: tenant.firmCode,
      planId: tenant.planId,
    };

    next();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// Verify a resource belongs to the current tenant
// Use this to prevent cross-tenant data access
// ─────────────────────────────────────────────

export function assertTenantOwnership(
  resourceTenantId: string,
  requestTenantId: string,
): void {
  if (resourceTenantId !== requestTenantId) {
    throw new ForbiddenError('Access denied');
  }
}
