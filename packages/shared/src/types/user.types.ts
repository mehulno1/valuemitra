import { UserRole } from './enums.js';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  gstin?: string;
  pan?: string;
  registeredAddress: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  logoUrl?: string;
  firmCode: string;       // Used in report reference numbers e.g. "UCVLLP"
  ibbiFirmRegNo?: string;
  rvoName?: string;
  planId: string;
  planExpiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;

  // IBBI compliance fields
  ibbiRegNo?: string;
  ibbiRegCategory?: string;
  ibbiRegValidUpto?: Date;
  rvoMembershipNo?: string;
  qualifications?: string;
  experienceYears?: number;
  signatureUrl?: string;
  stampUrl?: string;

  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfile extends Omit<User, 'tenantId'> {
  tenant: Pick<Tenant, 'id' | 'name' | 'firmCode' | 'logoUrl'>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expiry
}

export interface JwtPayload {
  sub: string;        // userId
  tenantId: string;
  role: UserRole;
  email: string;
  iat: number;
  exp: number;
}
