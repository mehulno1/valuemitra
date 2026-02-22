import { DocumentType, OCRStatus } from './enums.js';

export interface Document {
  id: string;
  tenantId: string;
  assignmentId: string;
  uploadedById: string;

  originalName: string;
  storagePath: string;
  storageProvider: 'local' | 's3';
  mimeType: string;
  fileSizeBytes: number;
  checksum?: string;

  documentType: DocumentType;
  subType?: string;

  ocrStatus: OCRStatus;
  ocrJobId?: string;
  ocrProvider?: 'google_vision' | 'azure_form_recognizer';
  ocrRawResponse?: Record<string, unknown>;
  ocrExtracted?: OCRExtractedData;
  ocrConfidence?: number;
  ocrReviewedAt?: Date;
  ocrReviewedById?: string;

  version: number;
  replacedById?: string;
  isDeleted: boolean;
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// OCR EXTRACTED DATA (structured output from OCR engine)
// Per the lifecycle diagram: Owner Name, Property Area,
// Survey/Plot Number, Valuation Reference are key OCR outputs
// ─────────────────────────────────────────────

export interface OCRExtractedData {
  // Common across document types
  ownerName?: string;
  ownerNames?: string[];
  propertyArea?: number;           // in sq.ft. or sq.m.
  propertyAreaUnit?: 'sqft' | 'sqm' | 'acre' | 'hectare';
  surveyNo?: string;               // Survey/Plot Number
  valuationReference?: string;

  // Sale Deed specific
  vendorName?: string;
  vendeeName?: string;
  considerationAmount?: number;
  registrationDate?: Date;
  registrationNumber?: string;
  propertyAddress?: string;
  boundaries?: {
    north?: string;
    south?: string;
    east?: string;
    west?: string;
  };

  // 7/12 Extract specific
  landType?: string;
  cultivationStatus?: string;
  encumbrances?: string;

  // Property Card specific
  ctsSurveyNo?: string;

  // Building Plan specific
  approvedBuiltUpArea?: number;
  fsi?: number;
  floorCount?: number;
  useType?: string;

  // Generic key-value pairs for unstructured extractions
  rawFields?: Record<string, string>;
}
