import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { SavePropertyDataInput, ExtractedPropertyData } from '@valuemitra/shared';

const PROPERTY_DATA_KEY = 'property-data';

export interface PropertyDataResponse {
  property: {
    id: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    pincode?: string | null;
    propertyType: string;
    // Core identification fields
    ownerNames?: string[] | null;
    surveyNo?: string | null;
    hissaNo?: string | null;
    ctsSurveyNo?: string | null;
    municipalNo?: string | null;
    societyName?: string | null;
    buildingName?: string | null;
    wingName?: string | null;
    flatNo?: string | null;
    floor?: number | null;
    // Location additions
    taluka?: string | null;
    village?: string | null;
    landmark?: string | null;
    municipalCorporation?: string | null;
    // Ownership
    ownershipNature?: string | null;
    ownerShareDetails?: string | null;
    developerName?: string | null;
    reraNo?: string | null;
    // Areas
    landAreaSqM?: number | null;
    builtUpAreaSqM?: number | null;
    carpetAreaSqM?: number | null;
    superBuiltUpAreaSqM?: number | null;
    superBuiltUpAreaSqFt?: number | null;
    unitConfiguration?: string | null;
    numberOfFloors?: number | null;
    yearOfConstruction?: number | null;
    ageOfBuilding?: number | null;
    structureType?: string | null;
    zoningClassification?: string | null;
    // Building compliance
    approvedPlanAuthority?: string | null;
    approvedPlanDate?: string | null;
    unauthorizedConstruction?: boolean | null;
    unauthorizedConstructionNotes?: string | null;
    demolitionProceedings?: boolean | null;
    demolitionProceedingsNotes?: string | null;
    // Actual site-measured areas
    builtUpAreaActualSqM?: number | null;
    builtUpAreaActualSqFt?: number | null;
    carpetAreaActualSqM?: number | null;
    carpetAreaActualSqFt?: number | null;
    landAreaActualSqM?: number | null;
    landAreaActualSqFt?: number | null;
    // UDS + land details
    udsArea?: number | null;
    udsUnit?: string | null;
    dpZone?: string | null;
    fsi?: number | null;
    permissibleUse?: string | null;
    naOrderDetails?: string | null;
    miDcPlotNo?: string | null;
    // Building compliance additions
    remainingLifeYears?: number | null;
    approvedPlanValidity?: string | null;
    planGenuinenessVerified?: boolean | null;
    // L&B floors
    buildingFloors?: Array<{ floorLabel: string; useType: string; builtUpAreaSqM?: number; builtUpAreaSqFt?: number; remarks?: string }> | null;
    // JSON grouped fields
    areaClassification?: Record<string, string> | null;
    physicalDetails?: Record<string, string> | null;
    boundaryDetails?: Record<string, string> | null;
    // New canonical fields (Phase 0 additions)
    ownerAddress?: string | null;
    ownerContact?: string | null;
    ownerPan?: string | null;
    borrowerName?: string | null;
    streetName?: string | null;
    district?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    landAreaSqFt?: number | null;
    landAreaAcre?: number | null;
    landAreaHectare?: number | null;
    leaseExpiryDate?: string | null;
    builtUpAreaSqFt?: number | null;
    carpetAreaSqFt?: number | null;
    buildingCompletionStatus?: string | null;
    roofType?: string | null;
    exteriorCondition?: string | null;
    interiorCondition?: string | null;
    externalDevAreaSqM?: number | null;
    externalDevAreaSqFt?: number | null;
    industrialStructures?: string | null;
    // Legal document fields
    registrationNo?: string | null;
    registrationDate?: string | null;
    indexIINo?: string | null;
    agreementValue?: string | null;
    stampDutyPaid?: string | null;
    occupancyCertificateNo?: string | null;
    approvedPlanNo?: string | null;
    sharesCertificateNo?: string | null;
    missingDocuments?: string[] | null;
    dataVerifiedAt?: string | null;
    dataVerifiedById?: string | null;
  };
  assignmentStatus: string;
  ocrReadyDocumentCount: number;
}

export function usePropertyData(assignmentId: string) {
  return useQuery({
    queryKey: [PROPERTY_DATA_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: PropertyDataResponse }>(`/property-data/${assignmentId}`)
        .then((r) => r.data.data),
    enabled: !!assignmentId,
  });
}

export function useExtractPropertyData() {
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api
        .post<{ success: boolean; data: ExtractedPropertyData }>(`/property-data/${assignmentId}/extract`)
        .then((r) => r.data.data),
  });
}

export function useSavePropertyData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: Partial<SavePropertyDataInput> }) =>
      api.patch<{ success: boolean; data: PropertyDataResponse['property'] }>(`/property-data/${assignmentId}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [PROPERTY_DATA_KEY, vars.assignmentId] }),
  });
}

export function useVerifyPropertyData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post<{ success: boolean }>(`/property-data/${assignmentId}/verify`).then((r) => r.data),
    onSuccess: (_d, assignmentId) => {
      void qc.invalidateQueries({ queryKey: [PROPERTY_DATA_KEY, assignmentId] });
      void qc.invalidateQueries({ queryKey: ['assignments', assignmentId] });
    },
  });
}
