#!/usr/bin/env node
/**
 * Template Processing Script
 * Replaces sample data in .docx templates with {token} placeholders
 * for use with docxtemplater.
 *
 * Run from project root:
 *   node scripts/process-templates.js
 *
 * Output: apps/api/src/modules/reports/templates/processed/
 */

const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'Report Templates');
const OUTPUT_DIR = path.join(
  __dirname, '..', 'apps', 'api', 'src', 'modules', 'reports', 'templates', 'processed'
);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// XML helpers
// ─────────────────────────────────────────────────────────────────────────────

function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function encodeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Apply replacements directly inside <w:t> elements (single-run targets). */
function replaceInRuns(xml, replacements) {
  return xml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (match, attrs, text) => {
    let decoded = decodeXml(text);
    let newText = decoded;

    for (const [find, replace] of replacements) {
      if (find instanceof RegExp) {
        newText = newText.replace(find, replace);
      } else {
        newText = newText.split(find).join(replace);
      }
    }

    if (newText === decoded) return match;
    return `<w:t${attrs}>${encodeXml(newText)}</w:t>`;
  });
}

/**
 * Normalize a paragraph (merge all run texts) and apply replacements.
 * Returns the rebuilt paragraph with a single run, preserving the first
 * run's character properties and the paragraph's paragraph properties.
 */
function normalizeParagraph(pXml, replacements) {
  // Collect full text from all runs
  let fullText = '';
  pXml.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, t) => {
    fullText += decodeXml(t);
  });

  if (!fullText.trim()) return pXml;

  let newText = fullText;
  for (const [find, replace] of replacements) {
    if (find instanceof RegExp) {
      newText = newText.replace(find, replace);
    } else {
      newText = newText.split(find).join(replace);
    }
  }

  if (newText === fullText) return pXml;

  // Preserve paragraph attributes
  const pTagMatch = pXml.match(/^<w:p(\s[^>]*)?>/);
  const pAttrs = pTagMatch ? (pTagMatch[1] || '') : '';

  // Preserve paragraph properties block
  const pPrMatch = pXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  // Use first run's character properties
  const rPrMatch = pXml.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';

  return `<w:p${pAttrs}>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${encodeXml(newText)}</w:t></w:r></w:p>`;
}

/**
 * Full XML processing:
 *   Stage 0 — raw XML string replacements (for injecting tokens into empty cells)
 *   Stage 1 — direct run replacements (single-run targets)
 *   Stage 2 — paragraph normalization for cross-run targets
 */
function processXml(xml, textReplacements, paragraphReplacements, rawXmlReplacements) {
  // Stage 0: raw XML substitutions (used for empty cells with no existing text)
  let result = xml;
  if (rawXmlReplacements && rawXmlReplacements.length > 0) {
    for (const [find, replace] of rawXmlReplacements) {
      result = result.split(find).join(replace);
    }
  }

  // Stage 1
  result = replaceInRuns(result, textReplacements);

  // Stage 2: only visit paragraphs that contain cross-run targets
  if (paragraphReplacements && paragraphReplacements.length > 0) {
    result = result.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, pXml => {
      let fullText = '';
      pXml.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, t) => {
        fullText += decodeXml(t);
      });

      const needsNormalization = paragraphReplacements.some(([pattern]) =>
        pattern instanceof RegExp ? pattern.test(fullText) : fullText.includes(pattern)
      );

      return needsNormalization
        ? normalizeParagraph(pXml, paragraphReplacements)
        : pXml;
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMON replacements — apply to every template
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_TEXT = [
  // Valuer identity (appears in signature block)
  ['Manoj Kumar Sharma',        '{rvFullName}'],
  ['MANOJ KUMAR SHARMA',        '{rvFullName}'],
  ['B.E (Civil), F.I.V., M.I.E', '{rvQualifications}'],
  ['IBBI/RV/07/2019/11044',     '{rvIbbiRegNo}'],
  // Firm city in signature ("Place: Thane" or "Place: - Thane")
  ['Place: - Thane',            'Place: {firmCity}'],
  ['Place: Thane',              'Place: {firmCity}'],
  // Firm name in UBI signature block
  ['Universal Consultant & Valuer LLP', '{firmName}'],
  // Govt rate year in heading (safe after ref-no replacement)
  ['GOVT. READY RECKONER RATE 2025-26', 'GOVT. READY RECKONER RATE {govtRateYear}'],
  ['GOVT. READY RECKNOR RATE 2025-26',  'GOVT. READY RECKONER RATE {govtRateYear}'],
  ['Government Ready Reckoner rate 2025-2026', 'Government Ready Reckoner rate {govtRateYear}'],
  ['Government Ready Reckoner Rate 2025-26',   'Government Ready Reckoner Rate {govtRateYear}'],
  // IBBI certificate / declaration text blocks — keep as tokens
  // (already static in templates, left as-is unless custom needed)
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-template configuration
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES = [
  // ── BOB ──────────────────────────────────────────────────────────────────
  {
    input:   'BOB - Open Land Format.docx',
    output:  'BOB_OpenLand.docx',
    bankCode: 'BOB', propertyType: 'LAND', isUnderConstruction: false,
    name: 'Bank of Baroda — Open Land',
    textReplacements: [
      ['M/s. J. M. Mhatre Infra Pvt. Ltd.',                        '{ownerName}'],
      ['N. A. Plot of Land bearing Survey No. 55, Hissa No. 2/A/1, Survey No. 68, Hissa No. 3/A/1, Survey No. 11, Survey No. 12, Hissa No. 1-B1, Survey No. 56, Hissa No. 6, Near Indospace Logistic Park, Khalapur \u2013 Pen Road, Village \u2013 Ajivali, Taluka - Khalapur, District \u2013 Raigad - 410203', '{propertyAddress}'],
      ['BANK OF BARODA \u2013 NARIMAN POINT PANVEL',               'BANK OF BARODA \u2013 {bankBranch}'],
      ['Bank of Baroda Branch \u2013 NARIMAN POINT PANVEL',        'Bank of Baroda Branch \u2013 {bankBranch}'],
      ['01-April-2024',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOB\/5362/, '{firmReferenceNo}'],
    ],
  },

  {
    input:   'BOB Office Format.docx',
    output:  'BOB_Office.docx',
    bankCode: 'BOB', propertyType: 'OFFICE', isUnderConstruction: false,
    name: 'Bank of Baroda — Office',
    textReplacements: [
      ['09-March-2021', '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOB\/865/, '{firmReferenceNo}'],
      // Questionnaire-style: ref + date in same line
      [/UCVLLP\/BOB\/865\s+Date:\s+09-March-2021/,
       '{firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  {
    input:   'BOB- L&B Format.docx',
    output:  'BOB_LandBuilding.docx',
    bankCode: 'BOB', propertyType: 'LAND_AND_BUILDING', isUnderConstruction: false,
    name: 'Bank of Baroda — Land & Building',
    textReplacements: [
      ['M/S. Vignaharta Oils & Chemicals Pvt. Ltd.',               '{ownerName}'],
      ['Industrial Factory Land & Building bearing Plot no. W-53 (II), MIDC, Taloja Industrial Area, Village Pendhar, Taluka Panvel, Dist. Raigad-410208.', '{propertyAddress}'],
      ['Bank of Baroda-Taloja Branch',       'Bank of Baroda-{bankBranch}'],
      ['Branch: Taloja Branch.',             'Branch: {bankBranch}.'],
      ['28/03/2024',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOB\/5124/, '{firmReferenceNo}'],
    ],
  },

  // ── BOI ──────────────────────────────────────────────────────────────────
  {
    input:   'BOI - Shop Format.docx',
    output:  'BOI_Shop.docx',
    bankCode: 'BOI', propertyType: 'SHOP', isUnderConstruction: false,
    name: 'Bank of India — Shop',
    textReplacements: [
      ['Mr. Kalpit Chokshi',                                        '{ownerName}'],
      ['Commercial Shop no. 4, Ground Floor, Futura, Near Seasons Mall, Mundhva \u2013 Kharadi Raod, Village - Hadapsar, Tal. Haweli, CTS No. 4944/9A Pune \u2013 411028.', '{propertyAddress}'],
      ['Bank Of India \u2013 Panchpakhadi, Thane Branch',           'Bank Of India \u2013 {bankBranch}'],
      ['Bank Of India, Panchpakhadi, Thane Branch.',                'Bank Of India, {bankBranch}.'],
      ['10/12/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOI\/9338/, '{firmReferenceNo}'],
    ],
  },

  {
    input:   'BOI Flat Format  - Under Construction.docx',
    output:  'BOI_Flat_UC.docx',
    bankCode: 'BOI', propertyType: 'FLAT', isUnderConstruction: true,
    name: 'Bank of India — Flat (Under Construction)',
    textReplacements: [
      // Owner name is in its own paragraph; "(Proposed Purchaser)" is next paragraph
      ['Mr. Bharat Tarachand Suthar & Mrs. Mamta Bharat Suthar', '{ownerName}'],
      ['Bank Of India, RBC Thane Branch',    'Bank Of India, {bankBranch}'],
      ['BRANCH: RBC THANE',                  'BRANCH: {bankBranch}'],
      ['28/03/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOI\/7314/, '{firmReferenceNo}'],
      // Property address split across runs in one paragraph
      ['Flat No. 3305, 33rd Habitable Floor, Wing-B, Shreeji Sky Rise Tower, Ambewadi, Opp. Fire Brigade, S.V. Road, Kandivali (W), Mumbai-400067.', '{propertyAddress}'],
    ],
  },

  // ── BOM ──────────────────────────────────────────────────────────────────
  {
    input:   'BOM - Flat Format - Under Construction.docx',
    output:  'BOM_Flat_UC.docx',
    bankCode: 'BOM', propertyType: 'FLAT', isUnderConstruction: true,
    name: 'Bank of Maharashtra — Flat (Under Construction)',
    textReplacements: [
      ["Mr. Sushant Shetty & Mrs. Edwina D\u2019Souza (Proposed Purchaser).", '{ownerName}'], // U+2019 smart quote
      ['Flat No. 1001, 10th Floor, C - Wing, Marquis Residences in Marquis Residence Phase 2, Chincholi Bunder Road, Survey No. 504 Pt, Old Survey No. 271, CTS No. 1406/10 and New CTS No. 1406/10/1, 1406/10/2 of Village Malad South, Malad West, Mumbai 400064.', '{propertyAddress}'],
      ['Bank of Maharashtra, Goregaon Branch', 'Bank of Maharashtra, {bankBranch}'],
      ['BRANCH: GOREGAON',                     'BRANCH: {bankBranch}'],
      ['06/09/2025',  '{reportDate}'],
      // Under-construction values
      [/Rs\.\s*22,92,000\/-/,  '{presentStageValue}'],
      [/Rs\.\s*1,52,80,000\/-/, '{finalValue}'],
      ['Rs. One Crore Fifty-Two Lakhs Eighty Thousand Only', '{finalValueWords}'],
      ['12/09/2025',  '{inspectionDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOM\/510/, '{firmReferenceNo}'],
    ],
  },

  {
    input:   'BOM - Office Format.docx',
    output:  'BOM_Office.docx',
    bankCode: 'BOM', propertyType: 'OFFICE', isUnderConstruction: false,
    name: 'Bank of Maharashtra — Office',
    textReplacements: [
      ['Commercial Office No. 412, 4th Floor, "ATL Corporate Park Premises Co-Operative Society Ltd.", Saki Vihar Road, Opp. L & T Gate No. 7, Powai, Mumbai 400072.', '{propertyAddress}'],
      ['29-October-2021', '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOM\/1585/, '{firmReferenceNo}'],
    ],
  },

  {
    input:   'BOM - Shop Format.docx',
    output:  'BOM_Shop.docx',
    bankCode: 'BOM', propertyType: 'SHOP', isUnderConstruction: false,
    name: 'Bank of Maharashtra — Shop',
    textReplacements: [
      ['Commercial Shop no. 34, Ground Floor, Vartak Nagar Shopkeepers Premises Co-op. Soc. Ltd., Pokran Road no. 1, Vartak Nagar, Thane (W)-400606.', '{propertyAddress}'],
      ['28/01/2026',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/BOM\/9696/, '{firmReferenceNo}'],
    ],
    // This template has blank questionnaire cells — inject tokens into empty answer cells
    rawXmlReplacements: [
      // Owner name cell (paraId 00000019 is the empty answer cell after the question)
      ['w14:paraId="00000019"><w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:vertAlign w:val="baseline"/></w:rPr></w:pPr><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr></w:r>',
       'w14:paraId="00000019"><w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:vertAlign w:val="baseline"/></w:rPr></w:pPr><w:r w:rsidDel="00000000" w:rsidR="00000000" w:rsidRPr="00000000"><w:rPr><w:rtl w:val="0"/></w:rPr><w:t>{ownerName}</w:t></w:r>'],
    ],
  },

  // ── CANARA ───────────────────────────────────────────────────────────────
  {
    input:   'Canara - Flat Format - Under Construction.docx',
    output:  'Canara_Flat_UC.docx',
    bankCode: 'CANARA', propertyType: 'FLAT', isUnderConstruction: true,
    name: 'Canara Bank — Flat (Under Construction)',
    textReplacements: [
      // Owner: "(PROPOSED PURCHASER)" is a separate paragraph
      ['VAISHALI LOKESH PATIL & LOKESH SAMPAT PATIL', '{ownerName}'],
      ['CANARA BANK-VASAI BRANCH',  'CANARA BANK-{bankBranch}'],
      ['12/09/2025',  '{reportDate}'],
      // UC values
      [/Rs\.\s*22,92,000\/-/,  '{presentStageValue}'],
      [/Rs\.\s*1,52,80,000\/-/, '{finalValue}'],
      ['Rs. One Crore Fifty-Two Lakhs Eighty Thousand Only', '{finalValueWords}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/CANARA\/25-26\/520/, '{firmReferenceNo}'],
      // Property address may be split across runs
      ['Flat No. 2402, 24th Floor, B-Wing, Shraddha Park City, LIG Mahindra & Mahindra CHSL, Shree Krishna Nagar, Survey No. 218, Hissa No. 1(P), 213 Hissa No. 2(P), 213 Hissa No. 3(P), CTS No. 2157/A, 2158/A, 2292/A/1 of Village Dahisar, Borivali East, Mumbai - 400066.', '{propertyAddress}'],
    ],
  },

  {
    input:   'Canara - Flat Format.docx',
    output:  'Canara_Flat.docx',
    bankCode: 'CANARA', propertyType: 'FLAT', isUnderConstruction: false,
    name: 'Canara Bank — Flat',
    textReplacements: [
      // Owner name; "(Proposed Purchaser)" is in a separate paragraph
      ['Mr. Nilesh N. Borade & Mr. Siddhesh N. Borade', '{ownerName}'],
      ['CANARA BANK-TALAO PALI-THANE BRANCH', 'CANARA BANK-{bankBranch}'],
      ['16/01/2026',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/CANARA\/9610/, '{firmReferenceNo}'],
      // Property address: "Residential Flat No. 403, 4" split from "th Floor..." across runs
      ['Residential Flat No. 403, 4th Floor, Building No. 2, Sapphire Tower, Regency Tower, Opp. Horizon School, Kavesar, G.B Road, Thane (W)- 400615.', '{propertyAddress}'],
    ],
  },

  {
    input:   'Canara - Format-L&B.docx',
    output:  'Canara_LandBuilding.docx',
    bankCode: 'CANARA', propertyType: 'LAND_AND_BUILDING', isUnderConstruction: false,
    name: 'Canara Bank — Land & Building',
    textReplacements: [
      // This template already has dashes for ref/date — replace blanks with tokens
      ['Mr. Shashikant Shantaram Bagkar', '{ownerName}'],
      ['Gut No. 278, Gram Panchayat House no. 570, 571, 592, 597 A/B/C, 1159 & 1147, at Village Kotluk, Guhaghar Aabloli Road, Taluka Guhaghar, Dist. Ratnagiri-415703.', '{propertyAddress}'],
      ['CANARA BANK------------------------ BRANCH', 'CANARA BANK-{bankBranch}'],
      // blank ref no and date (dashes) — the template already shows them as dashes
      // handled at paragraph level
    ],
    paragraphReplacements: [
      // Replace "UCVLLP/CANARA/---------" (already near-blank) with token
      [/UCVLLP\/CANARA\/[-\s]+/, '{firmReferenceNo}'],
      // Date was "----------------------" — hard to catch programmatically;
      // after paragraph normalization with "UCVLLP" match it will include date too
      [/UCVLLP\/CANARA\/[-\s]+\s+Date[:\s]+[-\s]+/, '{firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  {
    input:   'Canara - Shop Format.docx',
    output:  'Canara_Shop.docx',
    bankCode: 'CANARA', propertyType: 'SHOP', isUnderConstruction: false,
    name: 'Canara Bank — Shop',
    textReplacements: [
      ['M/s. Anagha Agro Impex Pvt.Ltd.',   '{ownerName}'],
      ['Commercial Shop cum Godown No. G-10, Ground Floor, MAPMC Market - 1, Phase - 2, Sector 19, Turbhe, Vashi, Navi Mumbai, Taluka & Dist. Thane-400703.', '{propertyAddress}'],
      ['CANARA BANK- NERUL BRANCH',           'CANARA BANK- {bankBranch}'],
      ['26/05/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/CANARA\/7756/, '{firmReferenceNo}'],
    ],
  },

  // ── NKGSB ────────────────────────────────────────────────────────────────
  {
    input:   'NKGSB - Land & Building.docx',
    output:  'NKGSB_LandBuilding.docx',
    bankCode: 'NKGSB', propertyType: 'LAND_AND_BUILDING', isUnderConstruction: false,
    name: 'NKGSB — Land & Building',
    textReplacements: [
      ['27/12/2024',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/NKGSB\/6467/, '{firmReferenceNo}'],
      [/Ref:\s*UCVLLP\/NKGSB\/6467\s*Date:\s*27\/12\/2024/,
       'Ref: {firmReferenceNo}  Date: {reportDate}'],
    ],
  },

  // ── PNB ──────────────────────────────────────────────────────────────────
  {
    input:   'PNB Flat Format - Under Construction.docx',
    output:  'PNB_Flat_UC.docx',
    bankCode: 'PNB', propertyType: 'FLAT', isUnderConstruction: true,
    name: 'Punjab National Bank — Flat (Under Construction)',
    textReplacements: [
      // Owner name is split across two paragraphs: Para1 = "MR. SANDIP... VORA & " Para2 = "MR. PREYANSH SANDIP VORA"
      ['MR. SANDIP PRAVINCHANDRA VORA, MRS. INDUMATI PRAVINCHANDRA VORA & ', '{ownerName}'],
      ['MR. PREYANSH SANDIP VORA', ''],  // second paragraph of split owner name → blank
      ["FLAT NO. 902, 9TH FLOOR, 'PRATAP LEGACY, DADABHAI ROAD, SURVEY NO. 186, CTS NO. 873, TPS VI, PLOT NO. 7, OF VILLAGE VILE PARLE, VILE PARLE WEST, MUMBAI 400056.", '{propertyAddress}'],
      ['PNB, BORIVALI WEST BRANCH -408304326390', 'PNB, {bankBranch} -{loanAccountNo}'],
      ['PUNJAB NATIONAL BANK, BORIVALI WEST BRANCH', 'PUNJAB NATIONAL BANK, {bankBranch}'],
      ['408304326390',   '{loanAccountNo}'],
      ['10/07/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/PNB\/2025-26\/433/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/PNB\/2025-26\/433\s+Date:\s*10\/07\/2025/,
       'Ref. No. {firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  {
    input:   'PNB Flat Format.docx',
    output:  'PNB_Flat.docx',
    bankCode: 'PNB', propertyType: 'FLAT', isUnderConstruction: false,
    name: 'Punjab National Bank — Flat',
    textReplacements: [
      ['RAJ NITIN SHAH & MOKSHA RAJ SHAH',  '{ownerName}'],
      ['FLAT NO. 4901, 49TH FLOOR, EAST WING, THE WORLD CREST, SENAPATI BAPAT MARG. CS NO. 443, 444, 445(PT), 446 OF VILLAGE LOWER PAREL, MUMBAI 400013', '{propertyAddress}'],
      ['PNB, LALBAUG BRANCH -302258526415', 'PNB, {bankBranch} -{loanAccountNo}'],
      ['PUNJAB NATIONAL BANK, LALBAUG BRANCH', 'PUNJAB NATIONAL BANK, {bankBranch}'],
      ['302258526415',   '{loanAccountNo}'],
      ['04/08/2025',  '{reportDate}'],
      ['02/08/2025',  '{inspectionDate}'],
      // Valuation table values
      ['48,000/-',    '{compositeRatePerSqFt}'],
      [/Rs\.\s*13,56,00,000\/-/,  '{buildingValue}'],
      [/Rs\.\s*15,00,000\/-/,     '{carParkingValuePerUnit}'],
      [/Rs\.\s*45,00,000\/-/,     '{carParkingTotalValue}'],
      [/Rs\.\s*14,01,00,000\s*\/-/, '{finalValue}'],
      [/Rs\.\s*14,01,00,000\/-/,  '{finalValue}'],
      ['Rupees Fourteen Crore One Lakh Only', '{finalValueWords}'],
    ],
    paragraphReplacements: [
      // Cross-run: "Ref. No. UCVLLP/ PNB/2025-26/" + "468" in next run
      [/UCVLLP\/\s*PNB\/2025-26\/468/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/\s*PNB\/2025-26\/468/,
       'Ref. No. {firmReferenceNo}'],
    ],
  },

  {
    input:   'PNB Shop Format.docx',
    output:  'PNB_Shop.docx',
    bankCode: 'PNB', propertyType: 'SHOP', isUnderConstruction: false,
    name: 'Punjab National Bank — Shop',
    textReplacements: [
      ['MRS. DIPIKABEN HEMENDRASINH SURMA W/o. MR. HEMENDRASINH SURMA', '{ownerName}'],
      ['SHOP NO. 112, 1ST FLOOR, A2 BUILDING, MARS-A, COSMO CITY, GRAM PANCHAYAT HOUSE NO. 1647(13), PLOT NO. 537 & 538 OF VILLAGE SAYLI, SILVASA, DADRA NAGAR HAVELI 396230', '{propertyAddress}'],
      ['PNB \u2013 MID CORPORATE BRANCH',       'PNB \u2013 {bankBranch}'],
      ['PUNJAB NATIONAL BANK, MID CORPORATE BRANCH', 'PUNJAB NATIONAL BANK, {bankBranch}'],
      ['28-05-2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/PNB\/373/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/PNB\/373\s+Date:\s*28-05-2025/,
       'Ref. No. {firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  // ── SBI ──────────────────────────────────────────────────────────────────
  {
    input:   'SBI - Office Format.docx',
    output:  'SBI_Office.docx',
    bankCode: 'SBI', propertyType: 'OFFICE', isUnderConstruction: false,
    name: 'State Bank of India — Office',
    textReplacements: [
      ['Mr. Aayush Prashant Agarwal',   '{ownerName}'],
      ['Commercial Office Unit no. 402, 4th Floor, Kamla Hub Juhu Office Premises Co-op. Soc. Ltd., Plot no. 53, JVPD Scheme, Near Aromas Cafe, N.S. Road no. 1, Village Vile Parle (W), Mumbai-400049.', '{propertyAddress}'],
      ['STATE BANK OF INDIA \u2013 NARIMAN POINT BRANCH', 'STATE BANK OF INDIA \u2013 {bankBranch}'],
      ['BRANCH: NARIMAN POINT BRANCH',  'BRANCH: {bankBranch}'],
      ['08/06/2024',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/SBI\/5468/, '{firmReferenceNo}'],
      [/Ref\s+No\.\s*:\s*UCVLLP\/SBI\/5468\s*Date:\s*08\/06\/2024/,
       'Ref No. : {firmReferenceNo}  Date: {reportDate}'],
    ],
  },

  {
    input:   'SBI-L & B - 5 cr. above-New Revised Format.docx',
    output:  'SBI_LandBuilding.docx',
    bankCode: 'SBI', propertyType: 'LAND_AND_BUILDING', isUnderConstruction: false,
    name: 'State Bank of India — Land & Building (5 Cr+)',
    textReplacements: [
      ['Mr. Kamal Daulatram Sewda,\r\nProprietor of M/s. Angel Steel Processing Unit.', '{ownerName}'],
      ['Mr. Kamal Daulatram Sewda, Proprietor of M/s. Angel Steel Processing Unit.',     '{ownerName}'],
      ['Mr. Kamal Daulatram Sewda, Proprietor of M/s. Angel Steel Processing Unit',      '{ownerName}'],
      ['Mr. Kamal Daulatram Sewda',   '{ownerName}'],
      ['Mr. Kamal Sewda',             '{ownerName}'],
      ['Land & Building situated at Plot No. C-23/2, MIDC,\r\nTaloja Industrial Area, Village Pendhar, Taloja,\r\nPanvel, Dist. Raigad -410208.', '{propertyAddress}'],
      ['Land & Building situated at Plot No. C-23/2, MIDC, Taloja Industrial Area, Village Pendhar, Taloja, Panvel, Dist. Raigad -410208.', '{propertyAddress}'],
      ['STATE BANK OF INDIA \u2013 BACKBAY RECLAMATION BRANCH', 'STATE BANK OF INDIA \u2013 {bankBranch}'],
      ['State Bank of India \u2013 Backbay Reclamation Branch', 'State Bank of India \u2013 {bankBranch}'],
      ['17/09/2025',  '{reportDate}'],
      // This template already has dashes for ref no — replace with token
    ],
    paragraphReplacements: [
      // "UCVLLP/SBI/-----" → token
      [/UCVLLP\/SBI\/[-\s]+/, '{firmReferenceNo}'],
      [/Ref No\.:\s*UCVLLP\/SBI\/[-\s]+\s*Date:\s*17\/09\/2025/,
       'Ref No.: {firmReferenceNo}  Date: {reportDate}'],
    ],
  },

  // ── UBI ──────────────────────────────────────────────────────────────────
  {
    input:   'UBI - Report Format - Under Construction.docx',
    output:  'UBI_Flat_UC.docx',
    bankCode: 'UBI', propertyType: 'FLAT', isUnderConstruction: true,
    name: 'Union Bank of India — Flat (Under Construction)',
    textReplacements: [
      ['RESHMA DHINGRA',  '{ownerName}'],
      ['FLAT NO. 3604, 36TH FLOOR, D WING, DOSTI AQUA IN DOSTI EASTERN BAY \u2013 PHASE 3, ANTOP HILL, VIDHYALANKAR COLLEGE ROAD, CTS NO. 2A/116(PT), 4/116 OF VILLAGE SALTPAN, WADALA EAST, MUMBAI 400037.', '{propertyAddress}'],
      ['UBI, RLP THANE BRANCH',  'UBI, {bankBranch}'],
      ['RLP THANE Branch',       '{bankBranch}'],
      ['11/06/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/UBI\/\s*25-26\/396/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/UBI\/\s*25-26\/396\s+Date:\s*11\/06\/2025/,
       'Ref. No. {firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  {
    input:   'UBI Flat Format.docx',
    output:  'UBI_Flat.docx',
    bankCode: 'UBI', propertyType: 'FLAT', isUnderConstruction: false,
    name: 'Union Bank of India — Flat',
    textReplacements: [
      ['MRS. VARSHA NITIN GUPTA',  '{ownerName}'],
      ['FLAT NO. 103, 1ST FLOOR, BUILDING NO. B-12, SILVER SARITA APARTMENT, SHREE OMKARESHWAR SILVER SARITA CO-OP. HSG. SOC. LTD., BUILDING NO. 10, 11, 12, SILVER SARITA COMPLEX, KASHIGAON, SURVEY NO. 107, 108, HISSA NO. 4 OF VILLAGE GHODBUNDER, MIRA BHAYANDAR ROAD, MIRA ROAD EAST, THANE 401107.', '{propertyAddress}'],
      ['UBI, BHAYANDER WEST BRANCH',  'UBI, {bankBranch}'],
      ['Bhayander West Branch',        '{bankBranch}'],
      ['12/12/2025',  '{reportDate}'],
      ['12.12.2025',  '{reportDate}'],
      // Valuation values from UBI Flat (500 sq ft @ 13,000/-)
      [/Rs\.\s*65,00,000\/-/,  '{finalValue}'],
      ['Rupees Sixty-Five Lakhs Only', '{finalValueWords}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/UBI\/\s*25-26\/607/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/UBI\/\s*25-26\/607\s+Date:\s*12\/12\/2025/,
       'Ref. No. {firmReferenceNo}    Date: {reportDate}'],
    ],
  },

  {
    input:   'UBI Shop Format.docx',
    output:  'UBI_Shop.docx',
    bankCode: 'UBI', propertyType: 'SHOP', isUnderConstruction: false,
    name: 'Union Bank of India — Shop',
    textReplacements: [
      ['MR. SANDEEP SUSHIL DROLIA',  '{ownerName}'],
      ['SHOP NO. 03, GROUND FLOOR, KAJAL HERITAGE CO-OPERATIVE HOUSING SOCIETY LTD., PLOT NO. 2A, SECTOR - 12D, KOPARKHAIRANE, NAVI MUMBAI, THANE - 400 709.', '{propertyAddress}'],
      ['UBI, UMFB BRANCH',  'UBI, {bankBranch}'],
      ['UMFB Branch',        '{bankBranch}'],
      ['18/12/2025',  '{reportDate}'],
    ],
    paragraphReplacements: [
      [/UCVLLP\/UBI\/25-26\/626/, '{firmReferenceNo}'],
      [/Ref\.\s*No\.\s*UCVLLP\/UBI\/25-26\/626\s+Date:\s*18\/12\/2025/,
       'Ref. No. {firmReferenceNo}    Date: {reportDate}'],
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main processing loop
// ─────────────────────────────────────────────────────────────────────────────

let successCount = 0;
let failCount = 0;

for (const tpl of TEMPLATES) {
  const inputPath  = path.join(TEMPLATES_DIR, tpl.input);
  const outputPath = path.join(OUTPUT_DIR, tpl.output);

  if (!fs.existsSync(inputPath)) {
    console.error(`  ✗ MISSING: ${tpl.input}`);
    failCount++;
    continue;
  }

  try {
    const content = fs.readFileSync(inputPath, 'binary');
    const zip = new PizZip(content);

    // Process word/document.xml
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) throw new Error('No word/document.xml found');

    let docXml = docXmlFile.asText();

    // Build combined replacement lists
    const textReplacements  = [...COMMON_TEXT, ...(tpl.textReplacements  || [])];
    const paraReplacements  = tpl.paragraphReplacements || [];

    const rawReplacements = tpl.rawXmlReplacements || [];
    docXml = processXml(docXml, textReplacements, paraReplacements, rawReplacements);
    zip.file('word/document.xml', docXml);

    // Also process word/header1.xml, word/header2.xml, word/footer1.xml etc.
    const extraFiles = Object.keys(zip.files).filter(f =>
      f.match(/^word\/(header|footer)\d*\.xml$/)
    );
    for (const xf of extraFiles) {
      let xml = zip.file(xf).asText();
      xml = processXml(xml, textReplacements, paraReplacements, rawReplacements);
      zip.file(xf, xml);
    }

    const output = zip.generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    fs.writeFileSync(outputPath, output);
    console.log(`  ✓ ${tpl.output}`);
    successCount++;
  } catch (err) {
    console.error(`  ✗ FAILED: ${tpl.input} — ${err.message}`);
    failCount++;
  }
}

console.log(`\nDone: ${successCount} processed, ${failCount} failed.`);
console.log(`Output: ${OUTPUT_DIR}`);
