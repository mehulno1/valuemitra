import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { UserRole, JwtPayload } from '@valuemitra/shared';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';

// ─────────────────────────────────────────────
// Verify JWT access token and attach user to request
// ─────────────────────────────────────────────

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Bearer token required'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new UnauthorizedError('Access token expired'));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new UnauthorizedError('Invalid access token'));
    }
    next(err);
  }
}

// ─────────────────────────────────────────────
// Role-Based Access Control (RBAC)
// ─────────────────────────────────────────────

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!roles.includes(req.user.role as UserRole)) {
      return next(new ForbiddenError(`Required role: ${roles.join(' or ')}`));
    }
    next();
  };
}

// Convenience guards
export const requireAdmin = requireRoles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN);
export const requireValuer = requireRoles(UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.VALUER);
export const requireNotViewer = requireRoles(
  UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.VALUER, UserRole.ASSISTANT
);
export const requireSuperAdmin = requireRoles(UserRole.SUPER_ADMIN);

// ─────────────────────────────────────────────
// JWT token generation
// ─────────────────────────────────────────────

export function generateAccessToken(payload: { sub: string; email: string; role: string; tenantId: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as StringValue,
    issuer: 'valuemitra',
  });
}
