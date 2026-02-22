import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../middleware/error.middleware.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';

// ─────────────────────────────────────────────
// Tenant profile management
// ─────────────────────────────────────────────

export async function getTenantProfile(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      firmCode: true,
      ibbiFirmRegNo: true,
      rvoName: true,
      gstin: true,
      pan: true,
      registeredAddress: true,
      city: true,
      state: true,
      pincode: true,
      phone: true,
      email: true,
      logoUrl: true,
      planId: true,
      planExpiresAt: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!tenant) throw new NotFoundError('Tenant not found');
  return tenant;
}

export async function updateTenantProfile(
  tenantId: string,
  actorId: string,
  data: {
    name?: string;
    registeredAddress?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    logoUrl?: string;
    firmCode?: string;
    ibbiFirmRegNo?: string;
    rvoName?: string;
    gstin?: string;
    pan?: string;
  },
) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw new NotFoundError('Tenant not found');

  const updated = await prisma.tenant.update({ where: { id: tenantId }, data });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'tenant.profile_updated',
    entityType: 'Tenant',
    entityId: tenantId,
    before: existing as Record<string, unknown>,
    after: updated as Record<string, unknown>,
  });

  return updated;
}

export async function getTenantStats(tenantId: string) {
  const [assignmentCount, userCount, documentCount] = await Promise.all([
    prisma.assignment.count({ where: { tenantId } }),
    prisma.user.count({ where: { tenantId, isActive: true } }),
    prisma.document.count({ where: { tenantId, isDeleted: false } }),
  ]);

  return { assignmentCount, userCount, documentCount };
}
