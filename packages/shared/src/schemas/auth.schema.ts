import { z } from 'zod';

export const RegisterTenantSchema = z.object({
  // First admin user
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),

  // Firm details
  firmName: z.string().min(2).max(200),
  firmCode: z.string().min(2).max(20).toUpperCase().optional(),
  ibbiFirmRegNo: z.string().max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
  ibbiRegNo: z.string().max(100).optional(),
  ibbiRegCategory: z.string().max(100).optional(),
  ibbiRegValidUpto: z.string().datetime().optional(),
  rvoMembershipNo: z.string().max(100).optional(),
  qualifications: z.string().max(500).optional(),
  experienceYears: z.number().int().min(0).max(60).optional(),
});

export type RegisterTenantInput = z.infer<typeof RegisterTenantSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
