import { z } from 'zod';
import { ValuationPurpose, PropertyType, ClientType, BankCode } from '../types/enums.js';

export const CreateClientSchema = z.object({
  clientType: z.nativeEnum(ClientType),
  // Name fields — use whichever matches the clientType
  fullName: z.string().min(2).max(200).optional(),      // INDIVIDUAL
  companyName: z.string().min(2).max(200).optional(),   // COMPANY / NBFC / HFC
  bankName: z.string().min(2).max(200).optional(),      // BANK
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional(),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/).optional(),
  cin: z.string().max(21).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  isBank: z.boolean().default(false),
  bankCode: z.nativeEnum(BankCode).optional(),
  bankBranch: z.string().max(200).optional(),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
  loanAccountNo: z.string().max(50).optional(),
});

export const CreateAssignmentSchema = z.object({
  clientId: z.string().uuid(),
  purposeOfValuation: z.nativeEnum(ValuationPurpose),
  propertyType: z.nativeEnum(PropertyType),
  propertyAddress: z.string().min(5).max(500),
  propertyCity: z.string().min(2).max(100),
  propertyState: z.string().min(2).max(100),
  propertyPincode: z.string().regex(/^\d{6}$/).optional(),
  isUnderConstruction: z.boolean().default(false),
  percentageCompletion: z.number().int().min(0).max(100).optional(),
  expectedHandoverDate: z.coerce.date().optional(),
  assignedToId: z.string().uuid().optional(),
  inspectionDate: z.coerce.date().optional(),
  remarks: z.string().max(2000).optional(),
});

export const UpdateAssignmentSchema = z.object({
  assignedToId: z.string().uuid().optional(),
  inspectionDate: z.coerce.date().optional(),
  propertyAddress: z.string().min(5).max(500).optional(),
  propertyCity: z.string().min(2).max(100).optional(),
  propertyState: z.string().min(2).max(100).optional(),
  propertyPincode: z.string().regex(/^\d{6}$/).optional(),
  isUnderConstruction: z.boolean().optional(),
  percentageCompletion: z.number().int().min(0).max(100).optional(),
  expectedHandoverDate: z.coerce.date().optional(),
  remarks: z.string().max(2000).optional(),
});

export const UpdatePropertySchema = z.object({
  surveyNo: z.string().max(100).optional(),
  ctsSurveyNo: z.string().max(100).optional(),
  municipalNo: z.string().max(100).optional(),          // plot / CTS / municipal plot number
  landAreaSqM: z.number().positive().optional(),
  builtUpAreaSqFt: z.number().positive().optional(),
  carpetAreaSqFt: z.number().positive().optional(),
  yearOfConstruction: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
  flatNo: z.string().max(50).optional(),                // flat / unit number
  numberOfFloors: z.number().int().positive().optional(),
  landTenure: z.enum(['FREEHOLD', 'LEASEHOLD', 'GOVERNMENT_LEASE']).optional(),
  zoningClassification: z.string().max(100).optional(), // residential / commercial / industrial
  structureType: z.string().max(100).optional(),        // RCC / load-bearing / steel
  ownerNames: z.array(z.string()).optional(),
  extractedData: z.record(z.unknown()).optional(),
});

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;
