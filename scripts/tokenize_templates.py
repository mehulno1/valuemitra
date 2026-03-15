#!/usr/bin/env python3
"""
ValueMitra — Template Tokenizer
Replaces value cells in processed .docx templates with {token} placeholders
for docxtemplater. Also replaces photo / map / RR sections with image tokens.

Usage:
    python3 scripts/tokenize_templates.py                   # all templates
    python3 scripts/tokenize_templates.py BOB_OpenLand.docx # one template

Writes output to uploads/templates/ (originals backed up first to templates_backup/).
"""

import sys, re, zipfile, shutil
from pathlib import Path
from copy import deepcopy

TEMPLATES_DIR = Path(__file__).parent.parent / 'apps/api/uploads/templates'
BACKUP_DIR    = Path(__file__).parent.parent / 'apps/api/uploads/templates_backup'

# ─── Helpers ──────────────────────────────────────────────────────────────────

def cell_text(xml):
    t = re.sub(r'<[^>]+>', '', xml)
    return re.sub(r'\s+', ' ', t).strip()

def para_text(xml):
    t = re.sub(r'<[^>]+>', ' ', xml)
    return re.sub(r'\s+', ' ', t).strip()

def normalize(s):
    return re.sub(r'\s+', ' ', s.lower()
                  .replace('/', ' ').replace('-', ' ').replace('.', ' ')
                  .replace('(', ' ').replace(')', ' ').replace(',', ' ')).strip()

def has_drawing(xml):
    return '<w:drawing>' in xml

def replace_cell_content(cell_xml, token):
    """Replace text content of a <w:tc> with a single token, preserving tcPr."""
    tcPr = ''
    m = re.search(r'<w:tcPr>.*?</w:tcPr>', cell_xml, re.DOTALL)
    if m:
        tcPr = m.group(0)

    pPr = ''
    pp = re.search(r'<w:pPr>.*?</w:pPr>', cell_xml, re.DOTALL)
    if pp:
        pPr = pp.group(0)

    return (f'<w:tc>{tcPr}<w:p>{pPr}'
            f'<w:r><w:t xml:space="preserve">{token}</w:t></w:r>'
            f'</w:p></w:tc>')

def replace_run_drawing(run_xml, token):
    """Replace a <w:r>...<w:drawing>...</w:drawing>...</w:r> with a plain text run."""
    rPr = ''
    m = re.search(r'<w:rPr>.*?</w:rPr>', run_xml, re.DOTALL)
    if m:
        rPr = m.group(0)
    return f'<w:r>{rPr}<w:t xml:space="preserve">{token}</w:t></w:r>'

# ─── Label → Token mapping ────────────────────────────────────────────────────

LABEL_TOKEN_MAP = [
    # General
    ('purpose for which the valuation',     '{purposeOfValuation}'),
    ('purpose of valuation',                '{purposeOfValuation}'),
    ('date of inspection',                  '{inspectionDate}'),
    ('date on which the valuation is made', '{valuationDate}'),
    ('date on which valuation',             '{valuationDate}'),
    ('valuation date',                      '{valuationDate}'),
    ('date of valuation',                   '{valuationDate}'),
    ('name of the owner',                   '{ownerName}'),
    ('name of borrower',                    '{ownerName}'),
    ('name of applicant',                   '{ownerName}'),
    ('name of mortgagor',                   '{ownerName}'),
    ('owner name',                          '{ownerName}'),
    ('brief description of the property',   '{propertyAddress}'),
    ('brief description',                   '{propertyAddress}'),
    ('description of the property',         '{propertyAddress}'),
    ('total lease period',                  '{landTenure}'),
    ('leasehold',                           '{landTenure}'),
    # Location / ID
    ('plot no   survey no',                 '{surveyNo}'),
    ('survey no',                           '{surveyNo}'),
    ('hissa no',                            '{hissaNo}'),
    ('cts no',                              '{ctsSurveyNo}'),
    ('cts survey no',                       '{ctsSurveyNo}'),
    ('door no',                             '{municipalNo}'),
    ('plot no',                             '{municipalNo}'),
    ('municipal no',                        '{municipalNo}'),
    ('t  s  no   village',                  '{village}'),
    ('village',                             '{village}'),
    ('ward   taluka',                       '{taluka}'),
    ('taluka',                              '{taluka}'),
    ('mandal   district',                   '{district}'),
    ('district',                            '{district}'),
    ('postal address',                      '{propertyAddress}'),
    ('address of the property',             '{propertyAddress}'),
    ('location of property',                '{propertyAddress}'),
    ('city   town',                         '{district}'),
    ('pin code',                            '{pincode}'),
    ('pincode',                             '{pincode}'),
    ('landmark',                            '{landmark}'),
    ('latitude',                            '{landmark}'),
    # Area classification
    ('high   middle   poor',                '{areaClassificationGrade}'),
    ('classification of area',              '{areaClassificationGrade}'),
    ('classification of locality',          '{areaClassificationGrade}'),
    ('urban   semi urban',                  '{urbanRuralClass}'),
    ('urban   semi-urban',                  '{urbanRuralClass}'),
    ('corporation limit',                   '{municipalBodyType}'),
    ('village panchayat',                   '{municipalBodyType}'),
    ('municipality',                        '{municipalBodyType}'),
    ('covered under any state',             '{govtEnactments}'),
    ('urban land ceiling',                  '{govtEnactments}'),
    # Extent / area
    ('extent of the site considered',       '{landAreaActualSqM}'),
    ('extent of site considered',           '{landAreaActualSqM}'),
    ('extent of the site',                  '{landAreaSqM}'),
    ('extent of site',                      '{landAreaSqM}'),
    ('size of plot',                        '{landAreaSqM}'),
    ('total extent',                        '{landAreaSqM}'),
    ('area of plot',                        '{landAreaSqM}'),
    ('land area',                           '{landAreaSqM}'),
    ('plot area',                           '{landAreaSqM}'),
    ('super built up area',                 '{superBuiltUpAreaSqFt}'),
    ('saleable area',                       '{superBuiltUpAreaSqFt}'),
    ('built up area',                       '{builtUpAreaSqFt}'),
    ('plinth area',                         '{builtUpAreaSqFt}'),
    ('carpet area',                         '{carpetAreaSqFt}'),
    ('undivided share',                     '{udsArea}'),
    ('uds',                                 '{udsArea}'),
    # Physical / site
    ('shape of land',                       '{plotShape}'),
    ('shape of plot',                       '{plotShape}'),
    ('shape',                               '{plotShape}'),
    ('type of use to which',                '{zoningClassification}'),
    ('type of use',                         '{zoningClassification}'),
    ('permissible use',                     '{permissibleUse}'),
    ('zoning',                              '{zoningClassification}'),
    ('development plan zone',               '{dpZone}'),
    ('dp zone',                             '{dpZone}'),
    ('fsi',                                 '{fsi}'),
    ('far',                                 '{fsi}'),
    ('occupied by the owner',               '{possessionStatus}'),
    ('whether occupied',                    '{possessionStatus}'),
    ('occupancy',                           '{possessionStatus}'),
    ('possession',                          '{possessionStatus}'),
    ('water potentiality',                  '{positiveFactors}'),
    ('underground sewerage',                '{positiveFactors}'),
    ('power supply',                        '{positiveFactors}'),
    ('advantage of the site',               '{positiveFactors}'),
    ('road facilities',                     '{positiveFactors}'),
    ('type of road',                        '{positiveFactors}'),
    ('width of road',                       '{positiveFactors}'),
    ('special remarks',                     '{negativeFactors}'),
    # Building
    ('type of building',                    '{zoningClassification}'),
    ('type of construction',                '{structureType}'),
    ('nature of construction',              '{structureType}'),
    ('rcc   load bearing',                  '{structureType}'),
    ('year of construction',                '{yearOfConstruction}'),
    ('age of building',                     '{ageOfBuilding}'),
    ('remaining life',                      '{remainingLifeYears}'),
    ('number of floors',                    '{numberOfFloors}'),
    ('no  of floors',                       '{numberOfFloors}'),
    ('number of storeys',                   '{numberOfFloors}'),
    ('condition of the building',           '{condition}'),
    ('exterior',                            '{condition}'),
    ('date of issue and validity',          '{approvedPlanDateFormatted}'),
    ('approved plan issuing authority',     '{approvedPlanAuthority}'),
    ('approved map   plan issuing',         '{approvedPlanAuthority}'),
    ('issuing authority',                   '{approvedPlanAuthority}'),
    ('genuineness or authenticity',         '{planGenuinenessVerified}'),
    ('genuineness of approved',             '{planGenuinenessVerified}'),
    ('plan genuineness',                    '{planGenuinenessVerified}'),
    ('unauthorized construction',           '{unauthorizedConstruction}'),
    ('demolition proceedings',              '{demolitionProceedings}'),
    ('flooring',                            '{flooringType}'),
    ('wall finishing',                      '{wallFinishing}'),
    ('electrical',                          '{electricalFittings}'),
    ('sanitary',                            '{sanitaryFittings}'),
    ('ceiling height',                      '{ceilingHeightFt}'),
    # Govt rate / valuation
    ('guideline rate',                      '{govtRatePerSqM}'),
    ('circle rate',                         '{govtRatePerSqM}'),
    ('ready reckoner',                      '{govtRatePerSqM}'),
    ('jantri rate',                         '{govtRatePerSqM}'),
    ('rr rate',                             '{govtRatePerSqM}'),
    ('registrar',                           '{govtRatePerSqM}'),
    ('prevailing market rate',              '{comparablesNarrative}'),
    ('assessed   adopted rate',             '{govtRatePerSqM}'),
    ('adopted rate',                        '{govtRatePerSqM}'),
    ('estimated value of land',             '{landValue}'),
    ('value of land',                       '{landValue}'),
    ('land value',                          '{landValue}'),
    ('estimated value of building',         '{buildingValue}'),
    ('value of building',                   '{buildingValue}'),
    ('building value',                      '{buildingValue}'),
    ('fair market value',                   '{fairMarketValue}'),
    ('market value',                        '{finalValue}'),
    ('realizable value',                    '{realizableValue}'),
    ('distress value',                      '{distressSaleValue}'),
    ('distress sale value',                 '{distressSaleValue}'),
    ('forced sale value',                   '{distressSaleValue}'),
    ('final value',                         '{finalValue}'),
    ('total value',                         '{finalValue}'),
    ('value as per circle rate',            '{govtRatePerSqM}'),
    ('insurance value',                     '{insuranceValue}'),
    ('rental value',                        '{rentalValueMonthly}'),
    ('book value',                          '{bookValue}'),
    # Bank / Client
    ('bank name',                           '{bankName}'),
    ('name of bank',                        '{bankName}'),
    ('bank branch',                         '{bankBranch}'),
    ('branch',                              '{bankBranch}'),
    ('loan account',                        '{loanAccountNo}'),
    ('account no',                          '{loanAccountNo}'),
    ('bank ref',                            '{bankRefNo}'),
    ('reference no',                        '{firmReferenceNo}'),
    ('report date',                         '{reportDate}'),
    ('date of report',                      '{reportDate}'),
    # RV
    ('name of valuer',                      '{rvFullName}'),
    ('valuer name',                         '{rvFullName}'),
    ('ibbi reg',                            '{rvIbbiRegNo}'),
    ('registration no',                     '{rvIbbiRegNo}'),
    ('rvo',                                 '{rvRvoName}'),
    ('qualifications',                      '{rvQualifications}'),
    # Marketability
    ('marketability',                       '{marketabilityRating}'),
    ('favourable factors',                  '{positiveFactors}'),
    ('positive factors',                    '{positiveFactors}'),
    ('negative factors',                    '{negativeFactors}'),
    ('unfavourable factors',                '{negativeFactors}'),
    ('market analysis',                     '{marketAnalysisNarrative}'),
    ('comparable transactions',             '{comparablesNarrative}'),
    ('comparables',                         '{comparablesNarrative}'),
]

BOUNDARY_LABELS = {
    'north': ('{northBoundaryDoc}', '{northBoundaryActual}'),
    'south': ('{southBoundaryDoc}', '{southBoundaryActual}'),
    'east':  ('{eastBoundaryDoc}',  '{eastBoundaryActual}'),
    'west':  ('{westBoundaryDoc}',  '{westBoundaryActual}'),
}

def find_token(label):
    norm = normalize(label)
    for pattern, token in LABEL_TOKEN_MAP:
        if pattern in norm:
            return token
    return None


# ─── Table row processing ─────────────────────────────────────────────────────

def process_row(row_xml, photo_state):
    """Process one <w:tr> element. Returns (new_row_xml, changed)."""
    cells = re.findall(r'<w:tc>.*?</w:tc>', row_xml, re.DOTALL)
    if len(cells) < 2:
        return row_xml, False

    texts = [cell_text(c) for c in cells]

    # Already tokenized — don't overwrite
    if any('{' in t for t in texts):
        return row_xml, False

    changed = False
    new_row = row_xml

    # ── Boundary rows ─────────────────────────────────────────────────────────
    first_norm = normalize(texts[0])
    for bkey, (doc_tok, act_tok) in BOUNDARY_LABELS.items():
        if first_norm == bkey or first_norm.startswith(bkey + ' '):
            if len(cells) >= 2 and not texts[1]:
                repl = replace_cell_content(cells[1], doc_tok)
                new_row = new_row.replace(cells[1], repl, 1)
                changed = True
            if len(cells) >= 3 and not texts[2]:
                # Re-extract cells after possible earlier replacement
                curr_cells = re.findall(r'<w:tc>.*?</w:tc>', new_row, re.DOTALL)
                if len(curr_cells) >= 3 and not cell_text(curr_cells[2]):
                    repl = replace_cell_content(curr_cells[2], act_tok)
                    new_row = new_row.replace(curr_cells[2], repl, 1)
                    changed = True
            return new_row, changed

    # ── Normal label → value rows ─────────────────────────────────────────────
    label_idx = -1
    for i, t in enumerate(texts[:-1]):
        if len(t) > 8:
            label_idx = i
            break

    if label_idx >= 0:
        token = find_token(texts[label_idx])
        if token:
            # Value cell = LAST empty cell in the row (rightmost/widest column)
            last_empty_idx = -1
            for j in range(len(cells) - 1, label_idx, -1):
                if not texts[j]:
                    last_empty_idx = j
                    break
            if last_empty_idx >= 0:
                repl = replace_cell_content(cells[last_empty_idx], token)
                new_row = new_row.replace(cells[last_empty_idx], repl, 1)
                changed = True

    return new_row, changed


# ─── Paragraph-level drawing replacement ─────────────────────────────────────

# Maps section heading keywords → image token prefix
SECTION_PHOTO_MAP = [
    ('photograph',    'propertyPhoto'),   # numbered 1-12
    ('location',      'locationMap'),
    ('ready reckoner','rrRateScreenshot'),
    ('rr rate',       'rrRateScreenshot'),
    ('price indicat', 'onlineRate'),      # numbered 1-4
    ('online rate',   'onlineRate'),
]

def process_paragraphs(xml_content, photo_state):
    """Find drawings in body paragraphs (outside tables) and replace with tokens.

    Strategy:
      1. Build table ranges to exclude table content.
      2. Scan paragraphs in document order, tracking current section heading.
      3. For each drawing paragraph, assign the next token from that section.
      4. Collect (start, end, new_xml) tuples and apply in REVERSE order so
         earlier positions are not disturbed by later replacements.
    """
    injected = 0

    # ── Build table ranges ────────────────────────────────────────────────────
    tbl_ranges = []
    for m in re.finditer(r'<w:tbl[ >]', xml_content):
        start = m.start()
        depth = 0; pos = start
        while pos < len(xml_content):
            if xml_content[pos:pos+6] == '<w:tbl' and pos+6 < len(xml_content) and xml_content[pos+6] in ' >':
                depth += 1; pos += 6
            elif xml_content[pos:pos+8] == '</w:tbl>':
                depth -= 1
                if depth == 0:
                    tbl_ranges.append((start, pos + 8)); break
                pos += 8
            else:
                pos += 1

    def in_table(pos):
        return any(s <= pos < e for s, e in tbl_ranges)

    # ── Scan paragraphs in order ──────────────────────────────────────────────
    current_section = None
    section_count   = {'propertyPhoto': 0, 'onlineRate': 0}
    pending = []  # list of (start, end, new_xml)

    for m in re.finditer(r'<w:p[ >]', xml_content):
        if in_table(m.start()):
            continue
        start = m.start()
        end_m = re.search(r'</w:p>', xml_content[start:])
        if not end_m:
            continue
        end = start + end_m.end()
        p_xml = xml_content[start:end]

        p_txt = para_text(p_xml).lower()

        # Detect section heading (can coexist with a drawing in the same para)
        for keyword, section_key in SECTION_PHOTO_MAP:
            if keyword in p_txt:
                if section_key != current_section:
                    current_section = section_key
                    if section_key == 'propertyPhoto':
                        section_count['propertyPhoto'] = 0
                    elif section_key == 'onlineRate':
                        section_count['onlineRate'] = 0
                break

        if not has_drawing(p_xml) or not current_section:
            continue

        # ── Assign token ──────────────────────────────────────────────────────
        if current_section == 'propertyPhoto':
            section_count['propertyPhoto'] += 1
            if section_count['propertyPhoto'] > 12:
                continue
            token = f'{{%propertyPhoto{section_count["propertyPhoto"]}}}'
        elif current_section == 'locationMap':
            token = '{%locationMap}'
            current_section = None
        elif current_section == 'rrRateScreenshot':
            token = '{%rrRateScreenshot}'
            current_section = None
        elif current_section == 'onlineRate':
            section_count['onlineRate'] += 1
            if section_count['onlineRate'] > 4:
                continue
            token = f'{{%onlineRate{section_count["onlineRate"]}}}'
        else:
            continue

        # ── Build replacement paragraph ───────────────────────────────────────
        # Keep tcPr / pPr if present; replace all drawing runs with one token run
        pPr = ''
        pp = re.search(r'<w:pPr>.*?</w:pPr>', p_xml, re.DOTALL)
        if pp:
            pPr = pp.group(0)

        # Determine the opening tag of the paragraph (may have attributes)
        p_open_m = re.match(r'<w:p[^>]*>', p_xml)
        p_open = p_open_m.group(0) if p_open_m else '<w:p>'

        new_p = (f'{p_open}{pPr}'
                 f'<w:r><w:t xml:space="preserve">{token}</w:t></w:r>'
                 f'</w:p>')

        pending.append((start, end, new_p))
        injected += 1
        print(f'  [PARA-IMG] {token}')

    # ── Apply replacements in REVERSE order (preserve positions) ─────────────
    for start, end, new_p in reversed(pending):
        xml_content = xml_content[:start] + new_p + xml_content[end:]

    return xml_content, injected


# ─── Main per-template processing ────────────────────────────────────────────

def process_template(docx_path: Path) -> int:
    print(f'\n{"="*60}')
    print(f'Processing: {docx_path.name}')
    print(f'{"="*60}')

    with zipfile.ZipFile(docx_path, 'r') as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = files['word/document.xml'].decode('utf-8')
    injected = 0
    photo_state = [0]  # photo counter shared across table rows

    # ── Pass 1: Table rows ────────────────────────────────────────────────────
    rows = re.findall(r'<w:tr[ >].*?</w:tr>', xml, re.DOTALL)
    for row in rows:
        new_row, changed = process_row(row, photo_state)
        if changed:
            xml = xml.replace(row, new_row, 1)
            injected += 1

    # ── Pass 2: Paragraph drawings (photos / maps / rr) ──────────────────────
    xml, para_injected = process_paragraphs(xml, photo_state)
    injected += para_injected

    files['word/document.xml'] = xml.encode('utf-8')

    with zipfile.ZipFile(docx_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    print(f'\n  ✓ {injected} tokens injected into {docx_path.name}')
    return injected


# ─── Entry point ─────────────────────────────────────────────────────────────

def backup_templates():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for f in TEMPLATES_DIR.glob('*.docx'):
        dest = BACKUP_DIR / f.name
        if not dest.exists():
            shutil.copy2(f, dest)
            count += 1
    if count:
        print(f'Backed up {count} new templates to {BACKUP_DIR}')

def main():
    if not TEMPLATES_DIR.exists():
        print(f'ERROR: {TEMPLATES_DIR} not found'); return

    # Always restore from backup first so re-runs are idempotent
    if BACKUP_DIR.exists():
        count = 0
        for f in BACKUP_DIR.glob('*.docx'):
            dest = TEMPLATES_DIR / f.name
            shutil.copy2(f, dest)
            count += 1
        print(f'Restored {count} templates from backup (clean slate)')
    else:
        backup_templates()

    targets = [TEMPLATES_DIR / sys.argv[1]] if len(sys.argv) > 1 else sorted(TEMPLATES_DIR.glob('*.docx'))

    total = 0
    for p in targets:
        if p.exists():
            total += process_template(p)

    print(f'\n{"="*60}')
    print(f'Total tokens injected: {total}')

if __name__ == '__main__':
    main()
