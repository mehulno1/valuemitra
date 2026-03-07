import { z } from 'zod';
import { PhotoCategory, ConstructionStageStatus, LiftInstallationStatus } from '../types/enums.js';

// ─────────────────────────────────────────────
// Assign Inspection (admin/valuer assigns an inspector)
// ─────────────────────────────────────────────

export const AssignInspectionSchema = z.object({
  inspectorId: z.string().uuid('Inspector must be a valid user'),
  scheduledDate: z.string().optional().nullable(),  // ISO date string
});

export type AssignInspectionInput = z.infer<typeof AssignInspectionSchema>;

// ─────────────────────────────────────────────
// Amenities JSON schema
// ─────────────────────────────────────────────

export const AmenitiesSchema = z.object({
  gym: z.boolean().optional(),
  club: z.boolean().optional(),
  pool: z.boolean().optional(),
  garden: z.boolean().optional(),
  security: z.boolean().optional(),
  intercom: z.boolean().optional(),
  generator: z.boolean().optional(),
  solarPower: z.boolean().optional(),
  // Legacy fields kept for backward compat
  lift: z.boolean().optional(),
  parking: z.boolean().optional(),
  water: z.boolean().optional(),
  power: z.boolean().optional(),
});

// ─────────────────────────────────────────────
// Save Inspection — full canonical param set
// ─────────────────────────────────────────────

const stageStatus = z.enum([
  ConstructionStageStatus.COMPLETED,
  ConstructionStageStatus.IN_PROGRESS,
  ConstructionStageStatus.NOT_STARTED,
]).optional().nullable();

export const SaveInspectionSchema = z.object({
  // SITE_001–003
  inspectionDate: z.string().optional().nullable(),
  propertyShownBy: z.string().max(200).optional().or(z.literal('')),
  propertyShownByPhone: z.string().max(15).optional().or(z.literal('')),
  propertyShownByDesignation: z.string().max(100).optional().or(z.literal('')),

  // SITE_004–009: Occupancy & identification
  occupancyStatus: z.enum(['SELF_OCCUPIED', 'TENANTED', 'VACANT', 'PARTIALLY_VACANT']).optional().nullable(),
  occupantName: z.string().max(200).optional().or(z.literal('')),
  occupantRelation: z.string().max(100).optional().or(z.literal('')),
  occupiedSince: z.string().max(50).optional().or(z.literal('')),
  flatNumberDisplayed: z.boolean().optional().nullable(),
  flatNumberAsDisplayed: z.string().max(50).optional().or(z.literal('')),
  nameOnBoard: z.string().max(200).optional().or(z.literal('')),

  // INS_003–008: Distances / connectivity
  nearestStationName: z.string().max(200).optional().or(z.literal('')),
  distanceFromStationKm: z.number().nonnegative().max(999).optional().nullable(),
  nearestBusStopName: z.string().max(200).optional().or(z.literal('')),
  distanceFromBusStopKm: z.number().nonnegative().max(999).optional().nullable(),
  distanceFromSchoolKm: z.number().nonnegative().max(999).optional().nullable(),
  distanceFromHospitalKm: z.number().nonnegative().max(999).optional().nullable(),

  // INS_009–013: Building characteristics
  groundFloorType: z.enum(['GROUND', 'STILT', 'BASEMENT', 'PODIUM', 'STILT_PODIUM']).optional().nullable(),
  storeyHeightFt: z.number().positive().max(100).optional().nullable(),
  flatsPerFloor: z.number().int().positive().optional().nullable(),
  numberOfWings: z.number().int().positive().optional().nullable(),
  numberOfLifts: z.number().int().nonnegative().optional().nullable(),

  // INS_014: Compound wall & gate type (replaces bool boundaryWall)
  compoundWallGateType: z.string().max(100).optional().or(z.literal('')),

  // Construction & condition
  constructionQuality: z.enum(['GOOD', 'AVERAGE', 'POOR']).optional().nullable(),
  maintenanceCondition: z.enum(['GOOD', 'AVERAGE', 'POOR']).optional().nullable(),

  // Amenities
  amenities: AmenitiesSchema.optional().nullable(),

  // INS_015–027: Unit / building finishes
  flooringType: z.string().max(100).optional().or(z.literal('')),          // INS_015/UNIT_007
  flooringExternal: z.string().max(100).optional().or(z.literal('')),      // INS_016
  flooringStaircase: z.string().max(100).optional().or(z.literal('')),     // INS_017
  flooringLobby: z.string().max(100).optional().or(z.literal('')),         // INS_018
  waterSupplyType: z.string().max(100).optional().or(z.literal('')),       // INS_019
  waterSupplyQuality: z.enum(['GOOD', 'NORMAL', 'POOR']).optional().nullable(),  // INS_020
  electrificationType: z.string().max(100).optional().or(z.literal('')),   // INS_021
  plumbingType: z.enum(['CONCEALED', 'OPEN']).optional().nullable(),       // INS_022
  externalWallFinish: z.string().max(100).optional().or(z.literal('')),    // INS_023
  roofType: z.string().max(100).optional().or(z.literal('')),              // INS_024
  doorType: z.string().max(100).optional().or(z.literal('')),              // INS_025
  windowType: z.string().max(100).optional().or(z.literal('')),            // INS_026
  kitchenPlatformMaterial: z.string().max(100).optional().or(z.literal('')), // INS_027
  wallFinishing: z.string().max(100).optional().or(z.literal('')),         // UNIT_008
  ceilingHeightFt: z.number().positive().max(100).optional().nullable(),   // UNIT_009
  doorsWindowsType: z.string().max(100).optional().or(z.literal('')),      // UNIT_010 legacy
  electricalFittings: z.string().max(100).optional().or(z.literal('')),    // UNIT_011
  sanitaryFittings: z.string().max(100).optional().or(z.literal('')),      // UNIT_012
  acType: z.string().max(50).optional().or(z.literal('')),                 // UNIT_013
  leaseholdDetails: z.string().max(500).optional().or(z.literal('')),      // UNIT_014

  // INS_028–032: Room count details
  numberOfRooms: z.number().int().nonnegative().optional().nullable(),
  numberOfToilets: z.number().int().nonnegative().optional().nullable(),
  numberOfBalconies: z.number().int().nonnegative().optional().nullable(),
  numberOfTerraces: z.number().int().nonnegative().optional().nullable(),
  accommodationDescription: z.string().max(1000).optional().or(z.literal('')),

  // INS_033–034: UC structural progress
  rccSlabCompleteFloor: z.string().max(100).optional().or(z.literal('')),
  brickworkCompleteFloor: z.string().max(100).optional().or(z.literal('')),

  // INS_035–044: UC stage status (individual columns)
  internalPlasterStatus: stageStatus,
  externalPlasterStatus: stageStatus,
  flooringWorkStatus: stageStatus,
  woodworkStatus: stageStatus,
  internalPaintingStatus: stageStatus,
  externalPaintingStatus: stageStatus,
  plumbingWorkStatus: stageStatus,
  electrificationWorkStatus: stageStatus,
  liftInstallationStatus: z.enum([
    LiftInstallationStatus.INSTALLED,
    LiftInstallationStatus.IN_PROGRESS,
    LiftInstallationStatus.NOT_STARTED,
  ]).optional().nullable(),
  finalFinishingStatus: stageStatus,

  // INS_045–047: Inspector market rate observations (internal only)
  observedRateCarpet: z.number().positive().optional().nullable(),
  observedRateSuba: z.number().positive().optional().nullable(),
  inspectorValueEstimate: z.number().positive().optional().nullable(),

  // INS_048–050: Broker details
  brokerName: z.string().max(200).optional().or(z.literal('')),
  brokerPhone: z.string().max(15).optional().or(z.literal('')),
  brokerFirmName: z.string().max(200).optional().or(z.literal('')),

  // Neighbourhood / approach
  neighborhoodType: z.string().max(100).optional().or(z.literal('')),
  approachRoadWidth: z.string().max(50).optional().or(z.literal('')),
  observationRemarks: z.string().max(2000).optional().or(z.literal('')),

  // Actual site measurements (measured during inspection)
  builtUpAreaActualSqM: z.number().positive().optional().nullable(),
  builtUpAreaActualSqFt: z.number().positive().optional().nullable(),
  carpetAreaActualSqM: z.number().positive().optional().nullable(),
  carpetAreaActualSqFt: z.number().positive().optional().nullable(),
  landAreaActualSqM: z.number().positive().optional().nullable(),
  landAreaActualSqFt: z.number().positive().optional().nullable(),
});

export type SaveInspectionInput = z.infer<typeof SaveInspectionSchema>;
export type AmenitiesInput = z.infer<typeof AmenitiesSchema>;

// ─────────────────────────────────────────────
// Photo upload with category
// ─────────────────────────────────────────────

export const PhotoUploadMetaSchema = z.object({
  photoCategory: z.nativeEnum(PhotoCategory).optional(),
  caption: z.string().max(300).optional(),
});

export type PhotoUploadMeta = z.infer<typeof PhotoUploadMetaSchema>;

// ─────────────────────────────────────────────
// Inspection response type (returned from API)
// ─────────────────────────────────────────────

export interface InspectionData {
  id: string;
  assignmentId: string;
  inspectorId: string;
  inspector: { id: string; fullName: string; email: string };
  scheduledDate: string | null;
  inspectionDate: string | null;
  // SITE_001–003
  propertyShownBy: string | null;
  propertyShownByPhone: string | null;
  propertyShownByDesignation: string | null;
  // SITE_004–009
  occupancyStatus: string | null;
  occupantName: string | null;
  occupantRelation: string | null;
  occupiedSince: string | null;
  flatNumberDisplayed: boolean | null;
  flatNumberAsDisplayed: string | null;
  nameOnBoard: string | null;
  // INS_003–008
  nearestStationName: string | null;
  distanceFromStationKm: number | null;
  nearestBusStopName: string | null;
  distanceFromBusStopKm: number | null;
  distanceFromSchoolKm: number | null;
  distanceFromHospitalKm: number | null;
  // INS_009–013
  groundFloorType: string | null;
  storeyHeightFt: number | null;
  flatsPerFloor: number | null;
  numberOfWings: number | null;
  numberOfLifts: number | null;
  // INS_014
  compoundWallGateType: string | null;
  // Condition
  constructionQuality: string | null;
  maintenanceCondition: string | null;
  amenities: AmenitiesInput | null;
  // INS_015–027
  flooringType: string | null;
  flooringExternal: string | null;
  flooringStaircase: string | null;
  flooringLobby: string | null;
  waterSupplyType: string | null;
  waterSupplyQuality: string | null;
  electrificationType: string | null;
  plumbingType: string | null;
  externalWallFinish: string | null;
  roofType: string | null;
  doorType: string | null;
  windowType: string | null;
  kitchenPlatformMaterial: string | null;
  wallFinishing: string | null;
  ceilingHeightFt: number | null;
  doorsWindowsType: string | null;
  electricalFittings: string | null;
  sanitaryFittings: string | null;
  acType: string | null;
  leaseholdDetails: string | null;
  // INS_028–032
  numberOfRooms: number | null;
  numberOfToilets: number | null;
  numberOfBalconies: number | null;
  numberOfTerraces: number | null;
  accommodationDescription: string | null;
  // INS_033–044 UC stages
  rccSlabCompleteFloor: string | null;
  brickworkCompleteFloor: string | null;
  internalPlasterStatus: string | null;
  externalPlasterStatus: string | null;
  flooringWorkStatus: string | null;
  woodworkStatus: string | null;
  internalPaintingStatus: string | null;
  externalPaintingStatus: string | null;
  plumbingWorkStatus: string | null;
  electrificationWorkStatus: string | null;
  liftInstallationStatus: string | null;
  finalFinishingStatus: string | null;
  // INS_045–050
  observedRateCarpet: number | null;
  observedRateSuba: number | null;
  inspectorValueEstimate: number | null;
  brokerName: string | null;
  brokerPhone: string | null;
  brokerFirmName: string | null;
  // Neighbourhood
  neighborhoodType: string | null;
  approachRoadWidth: string | null;
  observationRemarks: string | null;
  // Actual site measurements
  builtUpAreaActualSqM: number | null;
  builtUpAreaActualSqFt: number | null;
  carpetAreaActualSqM: number | null;
  carpetAreaActualSqFt: number | null;
  landAreaActualSqM: number | null;
  landAreaActualSqFt: number | null;
  isComplete: boolean;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
