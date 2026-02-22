import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../middleware/error.middleware.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import type { UserRole } from '@valuemitra/shared';

// ─────────────────────────────────────────────
// List users in the tenant
// ─────────────────────────────────────────────

export async function listUsers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      phone: true,
      ibbiRegNo: true,
      ibbiRegCategory: true,
      ibbiRegValidUpto: true,
      signatureUrl: true,
      createdAt: true,
    },
    orderBy: { fullName: 'asc' },
  });
}

// ─────────────────────────────────────────────
// Get single user (must belong to same tenant)
// ─────────────────────────────────────────────

export async function getUser(tenantId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, isActive: true },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      phone: true,
      ibbiRegNo: true,
      ibbiRegCategory: true,
      ibbiRegValidUpto: true,
      rvoMembershipNo: true,
      qualifications: true,
      experienceYears: true,
      signatureUrl: true,
      stampUrl: true,
      createdAt: true,
    },
  });
  if (!user) throw new NotFoundError('User not found');
  return user;
}

// ─────────────────────────────────────────────
// Invite / create a new team member
// ─────────────────────────────────────────────

export async function createUser(
  tenantId: string,
  actorId: string,
  data: {
    email: string;
    fullName: string;
    role: UserRole;
    password: string;
    phone?: string;
    ibbiRegNo?: string;
    ibbiRegCategory?: string;
    ibbiRegValidUpto?: Date;
  },
) {
  const existing = await prisma.user.findFirst({ where: { email: data.email, tenantId } });
  if (existing) throw new ConflictError('Email already in use within this tenant');

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      role: data.role,
      phone: data.phone,
      ibbiRegNo: data.ibbiRegNo,
      ibbiRegCategory: data.ibbiRegCategory,
      ibbiRegValidUpto: data.ibbiRegValidUpto,
    },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'user.created',
    entityType: 'User',
    entityId: user.id,
    after: { email: user.email, role: user.role },
  });

  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

// ─────────────────────────────────────────────
// Update user profile
// ─────────────────────────────────────────────

export async function updateUser(
  tenantId: string,
  actorId: string,
  actorRole: string,
  userId: string,
  data: {
    fullName?: string;
    phone?: string;
    ibbiRegNo?: string;
    ibbiRegCategory?: string;
    ibbiRegValidUpto?: Date;
    rvoMembershipNo?: string;
    qualifications?: string;
    experienceYears?: number;
    signatureUrl?: string;
    stampUrl?: string;
    role?: UserRole;
  },
) {
  const existing = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!existing) throw new NotFoundError('User not found');

  // Only TENANT_ADMIN can change roles
  if (data.role !== undefined && actorRole !== 'TENANT_ADMIN' && actorRole !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Only admins can change user roles');
  }

  // Users can only edit their own profile (admins can edit anyone in the tenant)
  if (actorId !== userId && actorRole !== 'TENANT_ADMIN' && actorRole !== 'SUPER_ADMIN') {
    throw new ForbiddenError('You can only edit your own profile');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      phone: true,
      ibbiRegNo: true,
      ibbiRegCategory: true,
      ibbiRegValidUpto: true,
      rvoMembershipNo: true,
      qualifications: true,
      experienceYears: true,
      signatureUrl: true,
      stampUrl: true,
    },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'user.updated',
    entityType: 'User',
    entityId: userId,
    before: existing as Record<string, unknown>,
    after: updated as Record<string, unknown>,
  });

  return updated;
}

// ─────────────────────────────────────────────
// Deactivate a user (soft delete)
// ─────────────────────────────────────────────

export async function deactivateUser(tenantId: string, actorId: string, userId: string) {
  if (actorId === userId) throw new ForbiddenError('Cannot deactivate your own account');

  const existing = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!existing) throw new NotFoundError('User not found');

  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

  // Revoke all refresh tokens
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { isRevoked: true },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'user.deactivated',
    entityType: 'User',
    entityId: userId,
  });
}
