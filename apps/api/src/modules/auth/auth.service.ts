import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { generateAccessToken } from '../../middleware/auth.middleware.js';
import {
  AppError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../../middleware/error.middleware.js';
import type { RegisterTenantInput, LoginInput } from '@valuemitra/shared';
import { seedBankClientsForTenant } from '../../prisma/seed-bank-clients.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function refreshExpiresAt(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────
// Register — creates Tenant + first TENANT_ADMIN atomically
// ─────────────────────────────────────────────

export async function registerTenant(input: RegisterTenantInput): Promise<{
  tenant: { id: string; name: string; slug: string };
  user: { id: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}> {
  // Email is globally unique at registration time (before tenantId exists)
  const existing = await prisma.user.findFirst({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already registered');

  const baseSlug = input.firmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let slug = baseSlug;
  const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
  if (existingTenant) {
    slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.firmName,
        slug,
        firmCode: input.firmCode ?? baseSlug.slice(0, 8).toUpperCase(),
        ibbiFirmRegNo: input.ibbiFirmRegNo,
        // Required Tenant fields with sensible defaults until firm completes profile
        registeredAddress: '',
        city: '',
        state: '',
        pincode: '',
        phone: '',
        email: input.email,
        planId: 'trial',
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        role: 'TENANT_ADMIN',
      },
    });

    return { tenant, user };
  });

  const accessToken = generateAccessToken({
    sub: result.user.id,
    email: result.user.email,
    role: result.user.role,
    tenantId: result.user.tenantId,
  });
  const rawRefreshToken = generateRefreshToken();

  // Pre-populate all 8 bank clients for the new tenant
  await seedBankClientsForTenant(result.tenant.id);

  await prisma.refreshToken.create({
    data: {
      userId: result.user.id,
      tokenHash: hashRefreshToken(rawRefreshToken),
      expiresAt: refreshExpiresAt(),
    },
  });

  return {
    tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug },
    user: { id: result.user.id, email: result.user.email, role: result.user.role },
    accessToken,
    refreshToken: rawRefreshToken,
  };
}

// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────

export async function login(input: LoginInput): Promise<{
  user: { id: string; email: string; fullName: string; role: string; tenantId: string };
  tenant: { id: string; name: string; slug: string; firmCode: string };
  accessToken: string;
  refreshToken: string;
}> {
  const user = await prisma.user.findFirst({
    where: { email: input.email, isActive: true },
    include: { tenant: true },
  });

  if (!user) throw new UnauthorizedError('Invalid credentials');

  const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatch) throw new UnauthorizedError('Invalid credentials');

  if (!user.tenant.isActive) {
    throw new AppError(403, 'Your firm account is suspended. Contact support.');
  }

  if (user.tenant.planExpiresAt && user.tenant.planExpiresAt < new Date()) {
    throw new AppError(402, 'Your subscription has expired. Please renew to continue.');
  }

  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });
  const rawRefreshToken = generateRefreshToken();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(rawRefreshToken),
        expiresAt: refreshExpiresAt(),
      },
    });
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
    },
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      firmCode: user.tenant.firmCode,
    },
    accessToken,
    refreshToken: rawRefreshToken,
  };
}

// ─────────────────────────────────────────────
// Refresh Token — rotate
// ─────────────────────────────────────────────

export async function refreshAccessToken(rawRefreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const tokenHash = hashRefreshToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, isRevoked: false },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { isRevoked: true },
      });
    }
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const { user } = stored;
  if (!user.isActive) throw new UnauthorizedError('Account is inactive');

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });

  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });
  const newRawRefreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(newRawRefreshToken),
      expiresAt: refreshExpiresAt(),
    },
  });

  return { accessToken, refreshToken: newRawRefreshToken };
}

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { isRevoked: true },
  });
}

// ─────────────────────────────────────────────
// Get current user profile
// ─────────────────────────────────────────────

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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

  if (!user) throw new NotFoundError('User not found');
  return user;
}
