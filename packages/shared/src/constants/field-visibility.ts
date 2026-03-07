import { PropertyType } from '../types/enums.js';

export interface FieldVisibilityFlags {
  // Location
  showWingName: boolean;              // Flat/Shop/Office; not Land/L&B
  showFlatNoAndFloor: boolean;        // Flat/Shop/Office/Bungalow
  showSocietyName: boolean;           // Flat only
  showHissaNo: boolean;               // Land/L&B only

  // Areas
  showCarpetArea: boolean;            // Flat/Shop/Office/Bungalow
  showSuperBuiltUp: boolean;          // Flat/Office
  showUnitConfiguration: boolean;     // Flat/Shop/Office
  showUdsArea: boolean;               // Flat only (Undivided Share of Land)
  showBuildingFloorsSection: boolean; // L&B only (per-floor table)

  // Building section (false for pure land types)
  showBuildingSection: boolean;

  // UC-specific
  showDeveloperReraFields: boolean;   // isUnderConstruction OR L&B

  // Inspection: Unit Finishes
  showUnitFinishes: boolean;          // Flat/Shop/Office/Bungalow (not Land/L&B)
  showLeaseholdDetails: boolean;      // Canara + Shop only

  // Valuation: bank-specific output inputs
  showPositiveNegativeFactors: boolean; // Canara (all property types)
  showInsuranceValueInput: boolean;     // SBI (Office/L&B), BOM (Flat/Shop/Office)
  showRentalValueInput: boolean;        // SBI (Office), Canara (Flat)
  showBookValueInput: boolean;          // BOM/UBI/Canara (UC+Flat), SBI (L&B)
  showPurchasePrice: boolean;           // BOI/UBI (UC+Flat)
}

const ALL_VISIBLE: FieldVisibilityFlags = {
  showWingName: true,
  showFlatNoAndFloor: true,
  showSocietyName: true,
  showHissaNo: true,
  showCarpetArea: true,
  showSuperBuiltUp: true,
  showUnitConfiguration: true,
  showUdsArea: true,
  showBuildingFloorsSection: true,
  showBuildingSection: true,
  showDeveloperReraFields: true,
  showUnitFinishes: true,
  showLeaseholdDetails: true,
  showPositiveNegativeFactors: true,
  showInsuranceValueInput: true,
  showRentalValueInput: true,
  showBookValueInput: true,
  showPurchasePrice: true,
};

/**
 * Returns field visibility flags for form rendering based on:
 * - propertyType: the type of property being valued
 * - bankCode: the client's bank code (null/undefined/"OTHER" → show all fields)
 * - isUnderConstruction: whether the property is under construction
 *
 * When bankCode is absent or 'OTHER' (non-bank client), ALL fields are shown.
 * When a bank is selected, only fields relevant to that bank + property type are shown.
 */
export function getFieldVisibility(
  propertyType: PropertyType,
  bankCode: string | null | undefined,
  isUnderConstruction: boolean,
): FieldVisibilityFlags {
  // Non-bank client (Individual/Company/NBFC/HFC) → show everything
  if (!bankCode || bankCode === 'OTHER') return ALL_VISIBLE;

  const isFlat     = propertyType === PropertyType.RESIDENTIAL_FLAT;
  const isBungalow = propertyType === PropertyType.RESIDENTIAL_BUNGALOW;
  const isShop     = propertyType === PropertyType.COMMERCIAL_SHOP ||
                     propertyType === PropertyType.COMMERCIAL_SHOWROOM;
  const isOffice   = propertyType === PropertyType.COMMERCIAL_OFFICE;
  const isLnB      = propertyType === PropertyType.LAND_AND_BUILDING;
  const isLand     = (
    propertyType === PropertyType.OPEN_LAND ||
    propertyType === PropertyType.AGRICULTURAL_LAND ||
    propertyType === PropertyType.RESIDENTIAL_PLOT ||
    propertyType === PropertyType.INDUSTRIAL_PLOT
  );
  const hasBuilding = isFlat || isBungalow || isShop || isOffice || isLnB;

  return {
    showWingName:              !isLand && !isLnB,
    showFlatNoAndFloor:        isFlat || isShop || isOffice || isBungalow,
    showSocietyName:           isFlat,
    showHissaNo:               isLnB || isLand,

    showCarpetArea:            isFlat || isShop || isOffice || isBungalow,
    showSuperBuiltUp:          isFlat || isOffice,
    showUnitConfiguration:     isFlat || isShop || isOffice,
    showUdsArea:               isFlat,
    showBuildingFloorsSection: isLnB,

    showBuildingSection:       hasBuilding,
    showDeveloperReraFields:   isUnderConstruction || isLnB,

    showUnitFinishes:          isFlat || isShop || isOffice || isBungalow,
    showLeaseholdDetails:      bankCode === 'CANARA' && isShop,

    showPositiveNegativeFactors: bankCode === 'CANARA',
    showInsuranceValueInput:
      (bankCode === 'SBI' && (isOffice || isLnB)) ||
      (bankCode === 'BOM' && (isFlat || isShop || isOffice)),
    showRentalValueInput:
      (bankCode === 'SBI' && isOffice) ||
      (bankCode === 'CANARA' && isFlat),
    showBookValueInput:
      (['BOM', 'UBI', 'CANARA'].includes(bankCode) && isFlat && isUnderConstruction) ||
      (bankCode === 'SBI' && isLnB),
    showPurchasePrice:
      ['BOI', 'UBI'].includes(bankCode) && isFlat && isUnderConstruction,
  };
}
