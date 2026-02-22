import { z } from 'zod';
import { StateCode, RateCategory } from '../types/enums.js';

export const FetchRatesSchema = z.object({
  state: z.nativeEnum(StateCode),
  district: z.string().min(2).max(100),
  taluka: z.string().max(100).optional(),
  village: z.string().max(100).optional(),
  rateYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),   // e.g. "2024-25"
});

export const QueryRatesSchema = z.object({
  state: z.nativeEnum(StateCode).optional(),
  district: z.string().max(100).optional(),
  taluka: z.string().max(100).optional(),
  village: z.string().max(100).optional(),
  rateYear: z.string().max(10).optional(),
  propertyCategory: z.nativeEnum(RateCategory).optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ManualRateSchema = z.object({
  state: z.nativeEnum(StateCode),
  rateYear: z.string().regex(/^\d{4}-\d{2}$/),
  district: z.string().min(2).max(100).optional(),
  taluka: z.string().max(100).optional(),
  village: z.string().max(100).optional(),
  zone: z.string().max(50).optional(),
  jantriZone: z.string().max(100).optional(),
  surveyType: z.string().max(50).optional(),
  propertyCategory: z.nativeEnum(RateCategory),
  ratePerSqM: z.number().positive().optional(),
  ratePerSqFt: z.number().positive().optional(),
  ratePerAcre: z.number().positive().optional(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  overrideNotes: z.string().max(500).optional(),
});

export const OverrideRateSchema = z.object({
  ratePerSqM: z.number().positive().optional(),
  ratePerSqFt: z.number().positive().optional(),
  ratePerAcre: z.number().positive().optional(),
  overrideNotes: z.string().min(5).max(500),
  effectiveTo: z.string().datetime().optional(),
});

export type FetchRatesInput = z.infer<typeof FetchRatesSchema>;
export type QueryRatesInput = z.infer<typeof QueryRatesSchema>;
export type ManualRateInput = z.infer<typeof ManualRateSchema>;
export type OverrideRateInput = z.infer<typeof OverrideRateSchema>;
