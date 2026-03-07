/**
 * Property-type-specific tab configuration for AssignmentDetailPage.
 *
 * Each property type has a different set of tabs (11–17 tabs).
 * The tab order drives the UI rendering in AssignmentDetailPage.
 */

export type SectionTabId =
  | 'general'
  | 'owner'
  | 'documents'
  | 'location'
  | 'area'
  | 'physical'
  | 'land'
  | 'boundary'
  | 'building'
  | 'unit'
  | 'external-dev'
  | 'site-visit'
  | 'valuation'
  | 'marketability'
  | 'report'
  | 'annexures';

export const TAB_LABELS: Record<SectionTabId, string> = {
  'general':      'General',
  'owner':        'Owner',
  'documents':    'Documents',
  'location':     'Location',
  'area':         'Area',
  'physical':     'Physical',
  'land':         'Land',
  'boundary':     'Boundaries',
  'building':     'Building',
  'unit':         'Unit',
  'external-dev': 'External Dev',
  'site-visit':   'Site Visit',
  'valuation':    'Valuation',
  'marketability':'Marketability',
  'report':       'Report',
  'annexures':    'Annexures',
};

/**
 * Which tabs appear for each canonical property type.
 * INSPECTOR role: always reduced to ['site-visit'] regardless of type.
 */
export const PROPERTY_TYPE_TABS: Record<string, SectionTabId[]> = {
  RESIDENTIAL_FLAT: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report',
  ],
  COMMERCIAL_SHOP: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  COMMERCIAL_OFFICE: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report',
  ],
  COMMERCIAL_SHOWROOM: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  OPEN_LAND: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  AGRICULTURAL_LAND: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  LAND_AND_BUILDING: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'building', 'unit', 'external-dev',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  UC_FLAT: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  // Legacy/fallback types default to residential flat layout
  RESIDENTIAL_BUNGALOW: [
    'general', 'owner', 'documents',
    'location', 'area', 'building', 'unit',
    'site-visit', 'valuation', 'marketability', 'report',
  ],
  RESIDENTIAL_PLOT: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'site-visit', 'valuation', 'marketability', 'report',
  ],
  INDUSTRIAL_FACTORY: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'building', 'unit', 'external-dev',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  INDUSTRIAL_PLOT: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
  MIXED_USE: [
    'general', 'owner', 'documents',
    'location', 'area', 'physical', 'land', 'boundary',
    'building', 'unit', 'external-dev',
    'site-visit', 'valuation', 'marketability', 'report', 'annexures',
  ],
};

/** Default fallback tab set for unrecognized property types */
const DEFAULT_TABS: SectionTabId[] = PROPERTY_TYPE_TABS['RESIDENTIAL_FLAT'] as SectionTabId[];

export function getTabsForType(propertyType: string): SectionTabId[] {
  return PROPERTY_TYPE_TABS[propertyType] ?? DEFAULT_TABS;
}

/** Quick lookup: does this property type have a specific tab? */
export function hasTab(propertyType: string, tabId: SectionTabId): boolean {
  return getTabsForType(propertyType).includes(tabId);
}
