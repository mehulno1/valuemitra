#!/usr/bin/env node
/**
 * Seed Report Templates
 *
 * 1. Copies processed .docx files → apps/api/uploads/templates/ (local dev storage)
 * 2. Upserts 21 rows into the report_templates DB table
 *
 * Run from project root:
 *   node scripts/seed-report-templates.js
 *
 * For production: upload processed/*.docx to S3 at templates/ prefix,
 * then run this script with STORAGE_PROVIDER=s3 set in env.
 */

const { PrismaClient } = require('@prisma/client');
const fs   = require('fs');
const path = require('path');

const PROCESSED_DIR = path.join(__dirname, '..', 'apps', 'api', 'src', 'modules', 'reports', 'templates', 'processed');
const UPLOADS_DIR   = path.join(__dirname, '..', 'apps', 'api', 'uploads', 'templates');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Bank name lookup
// ─────────────────────────────────────────────────────────────────────────────

const BANK_NAMES = {
  BOB:    'Bank of Baroda',
  BOI:    'Bank of India',
  BOM:    'Bank of Maharashtra',
  CANARA: 'Canara Bank',
  NKGSB:  'NKGSB Co-operative Bank',
  PNB:    'Punjab National Bank',
  SBI:    'State Bank of India',
  UBI:    'Union Bank of India',
};

// ─────────────────────────────────────────────────────────────────────────────
// Template catalogue (21 entries)
// Each entry defines:
//   output        — filename in processed/ and uploads/templates/
//   name          — human-readable display name
//   bankCode      — short bank identifier
//   propertyType  — property type enum value
//   uc            — isUnderConstruction
//   tokens        — actual {token} names present in this template
//                   (filters out accidental regex matches like long text)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TOKEN_NAMES = new Set([
  'referenceNo', 'firmReferenceNo', 'reportDate', 'inspectionDate', 'valuationDate',
  'rvFullName', 'rvIbbiRegNo', 'rvIbbiRegCategory', 'rvIbbiRegValidUpto',
  'rvQualifications', 'rvRvoName', 'rvPhone', 'rvEmail',
  'firmName', 'firmAddress', 'firmGstin', 'firmPhone', 'firmEmail', 'firmCity',
  'bankName', 'bankBranch', 'bankRefNo', 'clientName', 'loanAccountNo',
  'purposeOfValuation', 'propertyTypeLabel',
  'ownerName', 'propertyAddress', 'surveyNo', 'ctsSurveyNo', 'municipalNo',
  'societyName', 'flatNo', 'floor', 'buildingName', 'district', 'taluka', 'pincode',
  'landAreaSqFt', 'landAreaSqM', 'landTenure', 'zoningClassification',
  'builtUpAreaSqFt', 'builtUpAreaSqM', 'carpetAreaSqFt', 'carpetAreaSqM',
  'numberOfFloors', 'yearOfConstruction', 'ageOfBuilding', 'structureType', 'condition',
  'percentageCompletion', 'expectedHandoverDate',
  'govtRateYear', 'govtRatePerSqFt', 'govtRatePerSqM', 'govtRateSource',
  'landValue', 'buildingValue', 'finalValue', 'finalValueWords',
  'fairMarketValue', 'realizableValue', 'distressSaleValue',
  'compositeRatePerSqFt', 'carParkingCount', 'carParkingValuePerUnit',
  'carParkingTotalValue', 'presentStageValue',
  'rvSignature', 'rvStamp', 'comparablesNarrative',
  'ibbiCertificateText', 'independenceDeclaration', 'limitingConditions',
]);

const TEMPLATES = [
  // ── BOB ──────────────────────────────────────────────────────────────────
  {
    output: 'BOB_OpenLand.docx',
    name: 'Bank of Baroda — Open Land',
    bankCode: 'BOB', propertyType: 'LAND', uc: false,
  },
  {
    output: 'BOB_Office.docx',
    name: 'Bank of Baroda — Office',
    bankCode: 'BOB', propertyType: 'OFFICE', uc: false,
  },
  {
    output: 'BOB_LandBuilding.docx',
    name: 'Bank of Baroda — Land & Building',
    bankCode: 'BOB', propertyType: 'LAND_AND_BUILDING', uc: false,
  },
  // ── BOI ──────────────────────────────────────────────────────────────────
  {
    output: 'BOI_Shop.docx',
    name: 'Bank of India — Shop',
    bankCode: 'BOI', propertyType: 'SHOP', uc: false,
  },
  {
    output: 'BOI_Flat_UC.docx',
    name: 'Bank of India — Flat (Under Construction)',
    bankCode: 'BOI', propertyType: 'FLAT', uc: true,
  },
  // ── BOM ──────────────────────────────────────────────────────────────────
  {
    output: 'BOM_Flat_UC.docx',
    name: 'Bank of Maharashtra — Flat (Under Construction)',
    bankCode: 'BOM', propertyType: 'FLAT', uc: true,
  },
  {
    output: 'BOM_Office.docx',
    name: 'Bank of Maharashtra — Office',
    bankCode: 'BOM', propertyType: 'OFFICE', uc: false,
  },
  {
    output: 'BOM_Shop.docx',
    name: 'Bank of Maharashtra — Shop',
    bankCode: 'BOM', propertyType: 'SHOP', uc: false,
  },
  // ── CANARA ───────────────────────────────────────────────────────────────
  {
    output: 'Canara_Flat_UC.docx',
    name: 'Canara Bank — Flat (Under Construction)',
    bankCode: 'CANARA', propertyType: 'FLAT', uc: true,
  },
  {
    output: 'Canara_Flat.docx',
    name: 'Canara Bank — Flat',
    bankCode: 'CANARA', propertyType: 'FLAT', uc: false,
  },
  {
    output: 'Canara_LandBuilding.docx',
    name: 'Canara Bank — Land & Building',
    bankCode: 'CANARA', propertyType: 'LAND_AND_BUILDING', uc: false,
  },
  {
    output: 'Canara_Shop.docx',
    name: 'Canara Bank — Shop',
    bankCode: 'CANARA', propertyType: 'SHOP', uc: false,
  },
  // ── NKGSB ────────────────────────────────────────────────────────────────
  {
    output: 'NKGSB_LandBuilding.docx',
    name: 'NKGSB — Land & Building',
    bankCode: 'NKGSB', propertyType: 'LAND_AND_BUILDING', uc: false,
  },
  // ── PNB ──────────────────────────────────────────────────────────────────
  {
    output: 'PNB_Flat_UC.docx',
    name: 'Punjab National Bank — Flat (Under Construction)',
    bankCode: 'PNB', propertyType: 'FLAT', uc: true,
  },
  {
    output: 'PNB_Flat.docx',
    name: 'Punjab National Bank — Flat',
    bankCode: 'PNB', propertyType: 'FLAT', uc: false,
  },
  {
    output: 'PNB_Shop.docx',
    name: 'Punjab National Bank — Shop',
    bankCode: 'PNB', propertyType: 'SHOP', uc: false,
  },
  // ── SBI ──────────────────────────────────────────────────────────────────
  {
    output: 'SBI_Office.docx',
    name: 'State Bank of India — Office',
    bankCode: 'SBI', propertyType: 'OFFICE', uc: false,
  },
  {
    output: 'SBI_LandBuilding.docx',
    name: 'State Bank of India — Land & Building (5 Cr+)',
    bankCode: 'SBI', propertyType: 'LAND_AND_BUILDING', uc: false,
  },
  // ── UBI ──────────────────────────────────────────────────────────────────
  {
    output: 'UBI_Flat_UC.docx',
    name: 'Union Bank of India — Flat (Under Construction)',
    bankCode: 'UBI', propertyType: 'FLAT', uc: true,
  },
  {
    output: 'UBI_Flat.docx',
    name: 'Union Bank of India — Flat',
    bankCode: 'UBI', propertyType: 'FLAT', uc: false,
  },
  {
    output: 'UBI_Shop.docx',
    name: 'Union Bank of India — Shop',
    bankCode: 'UBI', propertyType: 'SHOP', uc: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Extract token list from processed .docx XML
// ─────────────────────────────────────────────────────────────────────────────

const PizZip = require('pizzip');

function extractTokens(docxPath) {
  const content = fs.readFileSync(docxPath, 'binary');
  const zip = new PizZip(content);
  const xml = zip.file('word/document.xml').asText();
  const all = (xml.match(/\{([^}%]+)\}/g) || []).map(t => t.slice(1, -1));
  return [...new Set(all)].filter(t => VALID_TOKEN_NAMES.has(t)).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('ValueMitra — Report Template Seeder');
  console.log('════════════════════════════════════\n');

  // 1. Ensure uploads/templates directory exists (local dev)
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  let seeded = 0;
  let copied = 0;

  for (const tpl of TEMPLATES) {
    const srcPath  = path.join(PROCESSED_DIR, tpl.output);
    const destPath = path.join(UPLOADS_DIR, tpl.output);

    if (!fs.existsSync(srcPath)) {
      console.error(`  ✗ MISSING processed file: ${tpl.output}`);
      continue;
    }

    // 1. Copy to uploads/templates/ for local dev
    fs.copyFileSync(srcPath, destPath);
    copied++;

    // 2. Extract tokens from the processed .docx
    const tokens = extractTokens(srcPath);

    // 3. Build fieldMappings: { tokenName: tokenName } (identity mapping)
    const fieldMappings = {};
    for (const t of tokens) fieldMappings[t] = t;

    // 4. Build requiredFields: always need firmReferenceNo + rvFullName + rvIbbiRegNo
    //    Plus any template-specific required fields
    const requiredFields = [...new Set([
      'firmReferenceNo',
      'rvFullName',
      'rvIbbiRegNo',
      ...tokens.filter(t => ['ownerName', 'propertyAddress', 'bankBranch'].includes(t)),
    ])];

    // 5. Upsert into DB (match on bankCode + propertyType + isUnderConstruction + name)
    const storagePath = `templates/${tpl.output}`;

    await prisma.reportTemplate.upsert({
      where: {
        // No unique index on these fields, so use findFirst + update/create
        id: (await prisma.reportTemplate.findFirst({
          where: {
            bankCode: tpl.bankCode,
            propertyType: tpl.propertyType,
            isUnderConstruction: tpl.uc,
            name: tpl.name,
            tenantId: null,
          },
          select: { id: true },
        }))?.id ?? 'new-' + tpl.output,
      },
      create: {
        tenantId: null,
        name: tpl.name,
        bankName: BANK_NAMES[tpl.bankCode],
        bankCode: tpl.bankCode,
        propertyType: tpl.propertyType,
        isUnderConstruction: tpl.uc,
        version: '1.0',
        templateFilePath: storagePath,
        fieldMappings,
        requiredFields,
        isActive: true,
      },
      update: {
        name: tpl.name,
        bankName: BANK_NAMES[tpl.bankCode],
        templateFilePath: storagePath,
        fieldMappings,
        requiredFields,
        isActive: true,
      },
    });

    seeded++;
    console.log(`  ✓ ${tpl.output.padEnd(30)} [${tokens.join(', ')}]`);
  }

  console.log(`\n✓ ${copied} files copied to uploads/templates/`);
  console.log(`✓ ${seeded}/${TEMPLATES.length} templates seeded into DB`);
}

main()
  .catch(err => { console.error('\nError:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
