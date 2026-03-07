import { z } from 'zod';
import { BuildingCompletionStatus, LandTenure } from '../types/enums.js';

// ─────────────────────────────────────────────
// Save Property Data (Phase A — verified by user after Claude extraction)
// ─────────────────────────────────────────────

// Boundary details JSON schema
export const BoundaryDetailsSchema = z.object({
  northDoc: z.string().max(300).optional().or(z.literal('')),
  southDoc: z.string().max(300).optional().or(z.literal('')),
  eastDoc: z.string().max(300).optional().or(z.literal('')),
  westDoc: z.string().max(300).optional().or(z.literal('')),
  northActual: z.string().max(300).optional().or(z.literal('')),
  southActual: z.string().max(300).optional().or(z.literal('')),
  eastActual: z.string().max(300).optional().or(z.literal('')),
  westActual: z.string().max(300).optional().or(z.literal('')),
}).optional().nullable();

// Area classification JSON schema
export const AreaClassificationSchema = z.object({
  type: z.string().max(50).optional().or(z.literal('')),          // Residential/Commercial/Industrial
  highMiddlePoor: z.string().max(20).optional().or(z.literal('')), // High/Middle/Poor
  urbanRural: z.string().max(30).optional().or(z.literal('')),    // Urban/Semi-Urban/Rural
  corpType: z.string().max(50).optional().or(z.literal('')),      // Corporation/Municipality/Gram Panchayat
  govtEnactments: z.string().max(500).optional().or(z.literal('')),
  czrNote: z.string().max(200).optional().or(z.literal('')),
}).optional().nullable();

// Physical details JSON schema
export const PhysicalDetailsSchema = z.object({
  landNature: z.string().max(50).optional().or(z.literal('')),
  landLayout: z.string().max(30).optional().or(z.literal('')),
  plotShape: z.string().max(30).optional().or(z.literal('')),
  directAccess: z.string().max(10).optional().or(z.literal('')),  // "Yes"/"No"
  accessMode: z.string().max(50).optional().or(z.literal('')),
  boundaryNature: z.string().max(50).optional().or(z.literal('')),
  demarcated: z.string().max(10).optional().or(z.literal('')),
  possession: z.string().max(50).optional().or(z.literal('')),
  tenancyNature: z.string().max(200).optional().or(z.literal('')),
  crops: z.string().max(200).optional().or(z.literal('')),
  otherDev: z.string().max(300).optional().or(z.literal('')),
}).optional().nullable();

export const SavePropertyDataSchema = z.object({
  // ─── Ownership (OWN_001–008) ───────────────────────────────
  ownerNames: z.array(z.string().min(1)).optional(),
  ownerAddress: z.string().max(500).optional().or(z.literal('')),     // OWN_002
  ownerContact: z.string().max(15).optional().or(z.literal('')),      // OWN_003
  ownerPan: z.string().max(10).optional().or(z.literal('')),          // OWN_004
  ownershipNature: z.string().max(30).optional().or(z.literal('')),   // OWN_005 Individual/Joint/Company/HUF/Partnership
  ownerShareDetails: z.string().max(500).optional().or(z.literal('')),// OWN_006
  borrowerName: z.string().max(200).optional().or(z.literal('')),     // OWN_007
  developerName: z.string().max(200).optional().or(z.literal('')),    // OWN_008 Builder (UC/L&B)
  reraNo: z.string().max(100).optional().or(z.literal('')),

  // ─── Identification (LOC section) ──────────────────────────
  surveyNo: z.string().max(100).optional().or(z.literal('')),
  hissaNo: z.string().max(50).optional().or(z.literal('')),
  ctsSurveyNo: z.string().max(100).optional().or(z.literal('')),
  municipalNo: z.string().max(100).optional().or(z.literal('')),
  societyName: z.string().max(200).optional().or(z.literal('')),
  buildingName: z.string().max(200).optional().or(z.literal('')),
  wingName: z.string().max(100).optional().or(z.literal('')),
  flatNo: z.string().max(50).optional().or(z.literal('')),
  floor: z.number().int().optional().nullable(),
  streetName: z.string().max(200).optional().or(z.literal('')),       // LOC_008

  // ─── Address / Location (LOC_001–017) ──────────────────────
  addressLine1: z.string().max(500).optional().or(z.literal('')),
  addressLine2: z.string().max(500).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  state: z.string().max(100).optional().or(z.literal('')),
  pincode: z.string().regex(/^\d{6}$/).optional().or(z.literal('')),
  district: z.string().max(100).optional().or(z.literal('')),         // LOC_003
  taluka: z.string().max(100).optional().or(z.literal('')),
  village: z.string().max(100).optional().or(z.literal('')),
  landmark: z.string().max(200).optional().or(z.literal('')),
  municipalCorporation: z.string().max(100).optional().or(z.literal('')),
  latitude: z.number().min(-90).max(90).optional().nullable(),        // LOC_015
  longitude: z.number().min(-180).max(180).optional().nullable(),     // LOC_016

  // Areas (sq.m. + sq.ft.) — document values
  landAreaSqM: z.number().positive().optional().nullable(),
  builtUpAreaSqM: z.number().positive().optional().nullable(),
  carpetAreaSqM: z.number().positive().optional().nullable(),
  landAreaSqFt: z.number().positive().optional().nullable(),
  builtUpAreaSqFt: z.number().positive().optional().nullable(),
  carpetAreaSqFt: z.number().positive().optional().nullable(),
  superBuiltUpAreaSqM: z.number().positive().optional().nullable(),
  superBuiltUpAreaSqFt: z.number().positive().optional().nullable(),
  unitConfiguration: z.string().max(100).optional().or(z.literal('')),

  // Actual site-measured areas (vs document values above)
  builtUpAreaActualSqM: z.number().positive().optional().nullable(),
  builtUpAreaActualSqFt: z.number().positive().optional().nullable(),
  carpetAreaActualSqM: z.number().positive().optional().nullable(),
  carpetAreaActualSqFt: z.number().positive().optional().nullable(),
  landAreaActualSqM: z.number().positive().optional().nullable(),
  landAreaActualSqFt: z.number().positive().optional().nullable(),

  // ─── Land details (LND_001–008) ────────────────────────────
  udsArea: z.number().positive().optional().nullable(),
  udsUnit: z.string().max(10).optional().or(z.literal('')),
  dpZone: z.string().max(100).optional().or(z.literal('')),
  fsi: z.number().positive().max(99).optional().nullable(),
  permissibleUse: z.string().max(200).optional().or(z.literal('')),
  naOrderDetails: z.string().max(300).optional().or(z.literal('')),
  miDcPlotNo: z.string().max(50).optional().or(z.literal('')),
  landAreaAcre: z.number().positive().optional().nullable(),          // LND alt unit
  landAreaHectare: z.number().positive().optional().nullable(),       // LND alt unit
  landTenure: z.nativeEnum(LandTenure).optional().nullable(),
  leaseExpiryDate: z.string().optional().nullable(),                  // ISO date

  // ─── Building (BLDG_001–016) ────────────────────────────────
  numberOfFloors: z.number().int().positive().optional().nullable(),
  yearOfConstruction: z.number().int().min(1800).max(2100).optional().nullable(),
  ageOfBuilding: z.number().int().min(0).optional().nullable(),
  remainingLifeYears: z.number().int().min(0).optional().nullable(),
  structureType: z.string().max(100).optional().or(z.literal('')),
  zoningClassification: z.string().max(100).optional().or(z.literal('')),
  buildingCompletionStatus: z.nativeEnum(BuildingCompletionStatus).optional().nullable(), // BLDG_006
  roofType: z.string().max(100).optional().or(z.literal('')),
  exteriorCondition: z.string().max(50).optional().or(z.literal('')),
  interiorCondition: z.string().max(50).optional().or(z.literal('')),

  // ─── External Development (BLDA_001–006) ───────────────────
  externalDevAreaSqM: z.number().nonnegative().optional().nullable(),
  externalDevAreaSqFt: z.number().nonnegative().optional().nullable(),
  industrialStructures: z.string().max(1000).optional().or(z.literal('')),

  // ─── Building compliance ────────────────────────────────────
  approvedPlanAuthority: z.string().max(100).optional().or(z.literal('')),
  approvedPlanDate: z.string().optional().nullable(),
  approvedPlanValidity: z.string().optional().nullable(),
  unauthorizedConstruction: z.boolean().optional().nullable(),
  unauthorizedConstructionNotes: z.string().max(2000).optional().or(z.literal('')),
  demolitionProceedings: z.boolean().optional().nullable(),
  demolitionProceedingsNotes: z.string().max(2000).optional().or(z.literal('')),
  planGenuinenessVerified: z.boolean().optional().nullable(),

  // ─── Building floors breakdown (L&B only) ──────────────────
  buildingFloors: z.array(z.object({
    floorLabel: z.string(),
    useType: z.string(),
    builtUpAreaSqM: z.number().optional(),
    builtUpAreaSqFt: z.number().optional(),
    remarks: z.string().optional(),
  })).optional().nullable(),

  // ─── Legal document references ──────────────────────────────
  registrationNo: z.string().max(100).optional().or(z.literal('')),
  registrationDate: z.string().optional().nullable(),
  indexIINo: z.string().max(100).optional().or(z.literal('')),
  agreementValue: z.number().positive().optional().nullable(),
  stampDutyPaid: z.number().positive().optional().nullable(),
  occupancyCertificateNo: z.string().max(100).optional().or(z.literal('')),
  approvedPlanNo: z.string().max(100).optional().or(z.literal('')),
  sharesCertificateNo: z.string().max(100).optional().or(z.literal('')),

  // ─── Grouped JSON fields ────────────────────────────────────
  areaClassification: AreaClassificationSchema,
  physicalDetails: PhysicalDetailsSchema,
  boundaryDetails: BoundaryDetailsSchema,

  // ─── Missing documents (for report remarks) ─────────────────
  missingDocuments: z.array(z.string()).optional(),
});

export type SavePropertyDataInput = z.infer<typeof SavePropertyDataSchema>;
export type BoundaryDetailsInput = z.infer<typeof BoundaryDetailsSchema>;
export type AreaClassificationInput = z.infer<typeof AreaClassificationSchema>;
export type PhysicalDetailsInput = z.infer<typeof PhysicalDetailsSchema>;

// ─────────────────────────────────────────────
// Claude extraction result (returned to frontend for review, not saved directly)
// ─────────────────────────────────────────────

export interface ExtractedPropertyData {
  // Owners / parties
  ownerNames: string[];
  ownershipNature: string | null;     // Individual / Joint / Company / HUF / Partnership
  ownerShareDetails: string | null;   // e.g. "50% each"
  developerName: string | null;       // Builder/Developer name

  // Property identification
  surveyNo: string | null;
  hissaNo: string | null;             // Hissa / sub-division number
  ctsSurveyNo: string | null;
  municipalNo: string | null;
  societyName: string | null;
  buildingName: string | null;
  wingName: string | null;            // Wing / Tower / Block
  flatNo: string | null;
  floor: number | null;               // 0 = ground floor
  reraNo: string | null;              // RERA registration number

  // Location
  taluka: string | null;
  village: string | null;             // Village / Mouje / Locality
  landmark: string | null;
  municipalCorporation: string | null; // MCGM / NMMC / CIDCO / Gram Panchayat

  // Areas (document values — square metres; convert sq.ft × 0.0929 if needed)
  landAreaSqM: number | null;
  builtUpAreaSqM: number | null;
  carpetAreaSqM: number | null;
  superBuiltUpAreaSqM: number | null;
  unitConfiguration: string | null;   // e.g. "2BHK+2T", "3BHK", "Open Plan Office"
  udsArea: number | null;             // Undivided Share of Land (for flats)
  udsUnit: string | null;             // "Sq.Ft" / "Sq.M" / "Fraction"

  // Building details
  numberOfFloors: number | null;
  yearOfConstruction: number | null;
  ageOfBuilding: number | null;
  structureType: string | null;       // RCC / Load Bearing / Steel / Composite
  zoningClassification: string | null; // Residential / Commercial / Industrial

  // Land / planning
  dpZone: string | null;              // Development Plan zone
  naOrderDetails: string | null;      // Non-agricultural order no., date, authority
  miDcPlotNo: string | null;          // MIDC plot number

  // Building compliance
  approvedPlanAuthority: string | null; // MCGM / NMMC / CIDCO / Gram Panchayat
  approvedPlanDate: string | null;    // ISO YYYY-MM-DD
  approvedPlanNo: string | null;

  // Legal documents
  registrationNo: string | null;
  registrationDate: string | null;    // ISO YYYY-MM-DD
  indexIINo: string | null;
  agreementValue: number | null;      // Rupees, no commas/symbols
  stampDutyPaid: number | null;       // Rupees
  occupancyCertificateNo: string | null;
  sharesCertificateNo: string | null;
}
