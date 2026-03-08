/**
 * SiteVisitSection — Site Engineer Inspection Form (Sections A–Q)
 *
 * A: Assignment Header (read-only reference)
 * B: Property Location (read-only from property data)
 * C: Person Met at Site
 * D: Property Status & Use
 * E: Connectivity & Proximity
 * F: Boundaries as Observed
 * G: Building Details
 * H: Documents Available at Site
 * I: Unit / Flat / Shop Details
 * J: Finishes & Specifications
 * K: Amenities
 * L: Area & Rate Observations
 * M: Under Construction Progress (UC_FLAT only)
 * N: Broker / Agent Details
 * O: Site Photos
 * P: Floor Plan Sketch
 * Q: Remarks & Observations
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { Separator } from '../../ui/separator.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Checkbox } from '../../ui/checkbox.js';
import { CheckCircle2, Upload, UserCheck, ClipboardCheck, Send, Save, FileDown, Trash2, MapPin } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useInspection, useAssignInspection, useUpdateInspection, useSubmitInspection } from '../../../api/hooks/useInspections.js';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../../api/hooks/useDocuments.js';
import { usePropertyData } from '../../../api/hooks/usePropertyData.js';
import { useUsers } from '../../../api/hooks/useUsers.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useAuthStore } from '../../../stores/auth.store.js';
import { LoadingSpinner } from '../../shared/LoadingSpinner.js';
import { PhotoCategory, ConstructionStageStatus, LiftInstallationStatus } from '@valuemitra/shared';
import type { AmenitiesInput } from '@valuemitra/shared';

// ── Dropdown options ───────────────────────────────────────────

const RELATIONSHIP_OPTIONS = [
  'Owner', 'Proposed Purchaser', 'Broker', 'Sales Executive',
  'Employee', 'Tenant', 'Caretaker', 'Other',
];

const OCCUPANCY_OPTIONS = [
  { value: 'VACANT', label: 'Vacant' },
  { value: 'SELF_OCCUPIED', label: 'Self Occupied' },
  { value: 'TENANTED', label: 'Tenanted' },
  { value: 'LOCKED', label: 'Locked' },
  { value: 'UNDER_CONSTRUCTION', label: 'Under Construction' },
  { value: 'PARTIALLY_VACANT', label: 'Partially Vacant' },
];

const USE_OPTIONS = ['Residential', 'Commercial', 'Industrial', 'Mixed'];

const STRUCTURE_TYPE_OPTIONS = [
  'RCC Frame', 'Load Bearing', 'Steel Structure', 'PEB Shed', 'Mixed',
];

const GROUND_FLOOR_OPTIONS = [
  { value: 'GROUND',      label: 'Ground' },
  { value: 'STILT',       label: 'Stilt' },
  { value: 'BASEMENT',    label: 'Basement' },
  { value: 'PODIUM',      label: 'Podium' },
  { value: 'STILT_PODIUM', label: 'Stilt + Podium' },
];

const PARKING_OPTIONS = ['Stilt', 'Open', 'Basement', 'Mechanical', 'None', 'Stilt + Open', 'Podium'];

const COMPOUND_WALL_OPTIONS = [
  'RCC Wall + Iron Gate', 'Iron Fencing', 'Brick Wall', 'Barbed Wire', 'No Compound',
];

const FLOORING_UNIT_OPTIONS = [
  'Kota', 'Ceramic', 'Vitrified', 'Granite', 'Marble', 'IPS', 'Mosaic', 'Not done',
];

const FLOORING_EXT_OPTIONS = [
  'Cement Concrete', 'Paving Block', 'Kota', 'IPS', 'None',
];

const FLOORING_STAIR_OPTIONS = [
  'Kota', 'Mosaic', 'Vitrified', 'Marble', 'Cement', 'Other',
];

const FLOORING_LOBBY_OPTIONS = [
  'Vitrified', 'Marble', 'Kota', 'PCC', 'None',
];

const WATER_SUPPLY_OPTIONS = [
  'Direct Municipal', 'UG Tank', 'OH Tank', 'Borewell', 'Tanker', 'None',
];

const ELECTRIFICATION_OPTIONS = [
  'Concealed', 'Open Wiring', 'Casing-Capping', 'Industrial 3-phase',
];

const EXT_WALL_OPTIONS = [
  'Sand-faced Plaster', 'Texture Paint', 'Glass Facade', 'Acrylic Paint',
  'Bare Brick', 'Exposed Brick', 'Stone Cladding',
];

const ROOF_OPTIONS = [
  'RCC Slab', 'AC Sheet', 'Mangalore Tile', 'PUF Panel', 'GI Sheet', 'Other',
];

const DOOR_OPTIONS = [
  'Wooden', 'Rolling Shutter', 'Glass', 'Steel', 'Safety Door', 'UPVC', 'Nil',
];

const WINDOW_OPTIONS = [
  'Aluminium', 'MS', 'UPVC', 'Wooden', 'Elevation Glass', 'None',
];

const KITCHEN_OPTIONS = [
  'Granite', 'Marble', 'Kadappa', 'Stainless Steel', 'Nil',
];

const DOCUMENTS_AT_SITE_OPTIONS = [
  'Agreement for Sale / Draft Agreement',
  'Approved Plan',
  'Property Card',
  '7/12 Extract',
  'NA Order',
  'CC (Commencement Certificate)',
  'OC (Occupancy Certificate)',
  'BCC (Building Completion Certificate)',
  'Share Certificate',
  'Electricity Bill',
  'Title Search Report',
  'Maintenance Receipt',
  'RERA Certificate',
  'Index II',
  'Lease Agreement',
  'Other',
];

const STAGE_STATUS_OPTIONS = [
  { value: ConstructionStageStatus.COMPLETED, label: 'Completed' },
  { value: ConstructionStageStatus.IN_PROGRESS, label: 'In Progress' },
  { value: ConstructionStageStatus.NOT_STARTED, label: 'Not Started' },
];

const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  BUILDING_EXTERIOR: 'Building Exterior ★',
  ENTRANCE_DOOR: 'Entrance Door ★',
  SOCIETY_BOARD: 'Society Board ★',
  LIVING_ROOM: 'Living Room / Hall ★',
  KITCHEN: 'Kitchen ★',
  BEDROOM: 'Bedroom',
  TOILET_BATHROOM: 'Toilet / Bathroom',
  TERRACE_BALCONY: 'Terrace / Balcony',
  INTERIOR_GENERAL: 'Interior General ★',
  DAMAGE_DEFECTS: 'Damage / Defects',
  APPROACH_ROAD: 'Approach Road ★',
  FLOOR_PLAN_SKETCH: 'Floor Plan Sketch ★',
};

// ── Amenity config ─────────────────────────────────────────────

const AMENITY_ITEMS: Array<{ key: keyof AmenitiesInput; label: string }> = [
  { key: 'carParking',        label: 'Car Parking' },
  { key: 'entranceLobby',     label: 'Entrance Lobby' },
  { key: 'pool',              label: 'Swimming Pool' },
  { key: 'gym',               label: 'Gymnasium' },
  { key: 'club',              label: 'Club House' },
  { key: 'generator',         label: 'Power Backup / Generator' },
  { key: 'garden',            label: 'Garden / Lawn' },
  { key: 'rollingShutter',    label: 'MS Rolling Shutter' },
  { key: 'facadeGlass',       label: 'Facade Glass' },
  { key: 'cctv',              label: 'CCTV Surveillance' },
  { key: 'intercom',          label: 'Intercom' },
  { key: 'security',          label: 'Security Cabin' },
  { key: 'rainwaterHarvesting', label: 'Rainwater Harvesting' },
  { key: 'solarPower',        label: 'Solar Panels' },
];

// ── Section heading helper ─────────────────────────────────────

function SectionCard({ letter, title, children }: { letter: string; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className="bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs font-bold shrink-0">{letter}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function SelectField({ label, value, onChange, options, disabled, placeholder = 'Select…', required }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string } | string>;
  disabled?: boolean; placeholder?: string; required?: boolean;
}) {
  const normalised = options.map((o) => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      <Select disabled={disabled} value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">— {placeholder} —</SelectItem>
          {normalised.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  assignmentId: string;
  propertyType: string;
  bankName: string | null;
  loanType: string | null;
  canEdit: boolean;
}

type ObservedBoundaries = {
  north: string; south: string; east: string; west: string;
  unitNorth: string; unitSouth: string; unitEast: string; unitWest: string;
};

const EMPTY_BOUNDS: ObservedBoundaries = {
  north: '', south: '', east: '', west: '',
  unitNorth: '', unitSouth: '', unitEast: '', unitWest: '',
};

const EMPTY_AMENITIES: AmenitiesInput = {};

// ── Component ─────────────────────────────────────────────────

export function SiteVisitSection({ assignmentId, propertyType, bankName, loanType, canEdit }: Props) {
  const { toast } = useToast();
  const { isInspector, isAdmin, isValuer } = usePermissions();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { data: inspection, isLoading } = useInspection(assignmentId);
  const { data: propertyData } = usePropertyData(assignmentId);
  const { data: users } = useUsers(!isInspector);
  const { data: allDocs } = useDocuments(assignmentId);
  const { mutate: assign, isPending: assigning } = useAssignInspection();
  const { mutate: update, isPending: updating } = useUpdateInspection();
  const { mutate: submit, isPending: submitting } = useSubmitInspection();
  const { mutate: uploadPhoto } = useUploadDocument();
  const { mutate: deleteDoc } = useDeleteDocument();

  const isUC = propertyType === 'UC_FLAT';
  const isLand = ['OPEN_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'].includes(propertyType);
  const isFlat = ['RESIDENTIAL_FLAT', 'UC_FLAT', 'RESIDENTIAL_BUNGALOW'].includes(propertyType);
  const hasUnit = !isLand;

  const [photoCategory, setPhotoCategory] = useState<string>(PhotoCategory.BUILDING_EXTERIOR);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [assignForm, setAssignForm] = useState({ inspectorId: '', scheduledDate: '' });

  // ── Form state ──────────────────────────────────────────────
  const [form, setForm] = useState({
    // A: Header
    inspectionDate: '',
    // C: Person met
    propertyShownBy: '',
    propertyShownByPhone: '',
    propertyShownByDesignation: '',
    // D: Status & use
    useOfProperty: '',
    occupancyStatus: '',
    occupantName: '',
    occupantRelation: '',
    occupiedSince: '',
    flatNumberAsDisplayed: '',
    nameOnBoard: '',
    flatNumberDisplayed: false as boolean,
    // E: Connectivity
    nearestStationName: '',
    distanceFromStationKm: '',
    nearestBusStopName: '',
    distanceFromBusStopKm: '',
    distanceFromSchoolKm: '',
    distanceFromHospitalKm: '',
    // F: Observed boundaries
    observedBoundaries: { ...EMPTY_BOUNDS },
    // G: Building
    groundFloorType: '',
    storeyHeightFt: '',
    flatsPerFloor: '',
    numberOfWings: '',
    numberOfLifts: '',
    compoundWallGateType: '',
    parkingType: '',
    parkingCount: '',
    constructionQuality: '',
    maintenanceCondition: '',
    neighborhoodType: '',
    approachRoadWidth: '',
    // H: Docs at site
    documentsAvailableAtSite: [] as string[],
    otherDocumentsNote: '',
    // I: Unit details
    carpetAreaActualSqFt: '',
    carpetAreaActualSqM: '',
    builtUpAreaActualSqFt: '',
    builtUpAreaActualSqM: '',
    landAreaActualSqFt: '',
    landAreaActualSqM: '',
    numberOfRooms: '',
    numberOfToilets: '',
    numberOfBalconies: '',
    numberOfTerraces: '',
    accommodationDescription: '',
    // J: Finishes
    flooringType: '',
    flooringExternal: '',
    flooringStaircase: '',
    flooringLobby: '',
    waterSupplyType: '',
    waterSupplyQuality: '',
    electrificationType: '',
    plumbingType: '',
    externalWallFinish: '',
    roofType: '',
    doorType: '',
    windowType: '',
    kitchenPlatformMaterial: '',
    wallFinishing: '',
    ceilingHeightFt: '',
    electricalFittings: '',
    sanitaryFittings: '',
    leaseholdDetails: '',
    // K: Amenities
    amenities: { ...EMPTY_AMENITIES } as AmenitiesInput,
    // L: Rates
    observedRateCarpet: '',
    observedRateSuba: '',
    inspectorValueEstimate: '',
    // M: UC stages
    rccSlabCompleteFloor: '',
    brickworkCompleteFloor: '',
    internalPlasterStatus: '',
    externalPlasterStatus: '',
    flooringWorkStatus: '',
    woodworkStatus: '',
    internalPaintingStatus: '',
    externalPaintingStatus: '',
    plumbingWorkStatus: '',
    electrificationWorkStatus: '',
    liftInstallationStatus: '',
    finalFinishingStatus: '',
    internalAccessAllowed: '' as '' | 'true' | 'false',
    // N: Broker
    brokerName: '',
    brokerPhone: '',
    brokerFirmName: '',
    // Q: Remarks
    observationRemarks: '',
  });

  function f(field: keyof typeof form) {
    return form[field] as string;
  }

  useEffect(() => {
    if (!inspection) return;
    const i = inspection;
    const bnd = (i.observedBoundaries ?? {}) as Partial<ObservedBoundaries>;
    setForm({
      inspectionDate: i.inspectionDate ? String(i.inspectionDate).slice(0, 10) : '',
      propertyShownBy: i.propertyShownBy ?? '',
      propertyShownByPhone: i.propertyShownByPhone ?? '',
      propertyShownByDesignation: i.propertyShownByDesignation ?? '',
      useOfProperty: i.useOfProperty ?? '',
      occupancyStatus: i.occupancyStatus ?? '',
      occupantName: i.occupantName ?? '',
      occupantRelation: i.occupantRelation ?? '',
      occupiedSince: i.occupiedSince ?? '',
      flatNumberAsDisplayed: i.flatNumberAsDisplayed ?? '',
      nameOnBoard: i.nameOnBoard ?? '',
      flatNumberDisplayed: i.flatNumberDisplayed ?? false,
      nearestStationName: i.nearestStationName ?? '',
      distanceFromStationKm: i.distanceFromStationKm != null ? String(i.distanceFromStationKm) : '',
      nearestBusStopName: i.nearestBusStopName ?? '',
      distanceFromBusStopKm: i.distanceFromBusStopKm != null ? String(i.distanceFromBusStopKm) : '',
      distanceFromSchoolKm: i.distanceFromSchoolKm != null ? String(i.distanceFromSchoolKm) : '',
      distanceFromHospitalKm: i.distanceFromHospitalKm != null ? String(i.distanceFromHospitalKm) : '',
      observedBoundaries: {
        north: bnd.north ?? '', south: bnd.south ?? '',
        east: bnd.east ?? '', west: bnd.west ?? '',
        unitNorth: bnd.unitNorth ?? '', unitSouth: bnd.unitSouth ?? '',
        unitEast: bnd.unitEast ?? '', unitWest: bnd.unitWest ?? '',
      },
      groundFloorType: i.groundFloorType ?? '',
      storeyHeightFt: i.storeyHeightFt != null ? String(i.storeyHeightFt) : '',
      flatsPerFloor: i.flatsPerFloor != null ? String(i.flatsPerFloor) : '',
      numberOfWings: i.numberOfWings != null ? String(i.numberOfWings) : '',
      numberOfLifts: i.numberOfLifts != null ? String(i.numberOfLifts) : '',
      compoundWallGateType: i.compoundWallGateType ?? '',
      parkingType: i.parkingType ?? '',
      parkingCount: i.parkingCount != null ? String(i.parkingCount) : '',
      constructionQuality: i.constructionQuality ?? '',
      maintenanceCondition: i.maintenanceCondition ?? '',
      neighborhoodType: i.neighborhoodType ?? '',
      approachRoadWidth: i.approachRoadWidth ?? '',
      documentsAvailableAtSite: i.documentsAvailableAtSite ?? [],
      otherDocumentsNote: i.otherDocumentsNote ?? '',
      carpetAreaActualSqFt: i.carpetAreaActualSqFt != null ? String(i.carpetAreaActualSqFt) : '',
      carpetAreaActualSqM: i.carpetAreaActualSqM != null ? String(i.carpetAreaActualSqM) : '',
      builtUpAreaActualSqFt: i.builtUpAreaActualSqFt != null ? String(i.builtUpAreaActualSqFt) : '',
      builtUpAreaActualSqM: i.builtUpAreaActualSqM != null ? String(i.builtUpAreaActualSqM) : '',
      landAreaActualSqFt: i.landAreaActualSqFt != null ? String(i.landAreaActualSqFt) : '',
      landAreaActualSqM: i.landAreaActualSqM != null ? String(i.landAreaActualSqM) : '',
      numberOfRooms: i.numberOfRooms != null ? String(i.numberOfRooms) : '',
      numberOfToilets: i.numberOfToilets != null ? String(i.numberOfToilets) : '',
      numberOfBalconies: i.numberOfBalconies != null ? String(i.numberOfBalconies) : '',
      numberOfTerraces: i.numberOfTerraces != null ? String(i.numberOfTerraces) : '',
      accommodationDescription: i.accommodationDescription ?? '',
      flooringType: i.flooringType ?? '',
      flooringExternal: i.flooringExternal ?? '',
      flooringStaircase: i.flooringStaircase ?? '',
      flooringLobby: i.flooringLobby ?? '',
      waterSupplyType: i.waterSupplyType ?? '',
      waterSupplyQuality: i.waterSupplyQuality ?? '',
      electrificationType: i.electrificationType ?? '',
      plumbingType: i.plumbingType ?? '',
      externalWallFinish: i.externalWallFinish ?? '',
      roofType: i.roofType ?? '',
      doorType: i.doorType ?? '',
      windowType: i.windowType ?? '',
      kitchenPlatformMaterial: i.kitchenPlatformMaterial ?? '',
      wallFinishing: i.wallFinishing ?? '',
      ceilingHeightFt: i.ceilingHeightFt != null ? String(i.ceilingHeightFt) : '',
      electricalFittings: i.electricalFittings ?? '',
      sanitaryFittings: i.sanitaryFittings ?? '',
      leaseholdDetails: i.leaseholdDetails ?? '',
      amenities: (i.amenities as AmenitiesInput | null) ?? { ...EMPTY_AMENITIES },
      observedRateCarpet: i.observedRateCarpet != null ? String(i.observedRateCarpet) : '',
      observedRateSuba: i.observedRateSuba != null ? String(i.observedRateSuba) : '',
      inspectorValueEstimate: i.inspectorValueEstimate != null ? String(i.inspectorValueEstimate) : '',
      rccSlabCompleteFloor: i.rccSlabCompleteFloor ?? '',
      brickworkCompleteFloor: i.brickworkCompleteFloor ?? '',
      internalPlasterStatus: i.internalPlasterStatus ?? '',
      externalPlasterStatus: i.externalPlasterStatus ?? '',
      flooringWorkStatus: i.flooringWorkStatus ?? '',
      woodworkStatus: i.woodworkStatus ?? '',
      internalPaintingStatus: i.internalPaintingStatus ?? '',
      externalPaintingStatus: i.externalPaintingStatus ?? '',
      plumbingWorkStatus: i.plumbingWorkStatus ?? '',
      electrificationWorkStatus: i.electrificationWorkStatus ?? '',
      liftInstallationStatus: i.liftInstallationStatus ?? '',
      finalFinishingStatus: i.finalFinishingStatus ?? '',
      internalAccessAllowed: i.internalAccessAllowed == null ? '' : i.internalAccessAllowed ? 'true' : 'false',
      brokerName: i.brokerName ?? '',
      brokerPhone: i.brokerPhone ?? '',
      brokerFirmName: i.brokerFirmName ?? '',
      observationRemarks: i.observationRemarks ?? '',
    });
  }, [inspection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAssignedInspector = inspection?.inspectorId === currentUserId;
  const canFillForm = isInspector || isAssignedInspector || isAdmin;
  const formDisabled = !canFillForm || (!!inspection?.isComplete && !isAdmin);
  const showAssignSection = (isAdmin || isValuer) && !inspection;

  // ── Photo upload ─────────────────────────────────────────────
  const inspectionPhotos = (allDocs ?? []).filter(
    (d) => ['INSPECTION_PHOTO', 'EXTERIOR_PHOTO', 'SITE_PHOTOGRAPH'].includes(d.documentType),
  );

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadingCount((c) => c + files.length);
    files.forEach((file) => {
      uploadPhoto(
        { assignmentId, file, documentType: 'INSPECTION_PHOTO', photoCategory },
        {
          onSuccess: () => { setUploadingCount((c) => c - 1); toast({ title: `${file.name} uploaded` }); },
          onError: () => { setUploadingCount((c) => c - 1); toast({ title: `Failed: ${file.name}`, variant: 'destructive' }); },
        },
      );
    });
    e.target.value = '';
  }

  // Auto-convert carpet sqft → sqm
  function handleCarpetSqFt(val: string) {
    const sqft = parseFloat(val);
    const sqm = !isNaN(sqft) ? String((sqft * 0.0929).toFixed(2)) : '';
    setForm((p) => ({ ...p, carpetAreaActualSqFt: val, carpetAreaActualSqM: sqm }));
  }

  function toggleDoc(doc: string) {
    setForm((p) => {
      const list = p.documentsAvailableAtSite;
      return {
        ...p,
        documentsAvailableAtSite: list.includes(doc) ? list.filter((d) => d !== doc) : [...list, doc],
      };
    });
  }

  // ── Save draft ───────────────────────────────────────────────
  function handleSaveDraft() {
    update({
      assignmentId,
      data: {
        inspectionDate: form.inspectionDate || undefined,
        propertyShownBy: form.propertyShownBy || undefined,
        propertyShownByPhone: form.propertyShownByPhone || undefined,
        propertyShownByDesignation: form.propertyShownByDesignation || undefined,
        useOfProperty: form.useOfProperty || undefined,
        occupancyStatus: (form.occupancyStatus || undefined) as 'SELF_OCCUPIED' | 'TENANTED' | 'VACANT' | 'PARTIALLY_VACANT' | 'LOCKED' | 'UNDER_CONSTRUCTION' | undefined,
        occupantName: form.occupantName || undefined,
        occupantRelation: form.occupantRelation || undefined,
        occupiedSince: form.occupiedSince || undefined,
        flatNumberDisplayed: form.flatNumberDisplayed,
        flatNumberAsDisplayed: form.flatNumberAsDisplayed || undefined,
        nameOnBoard: form.nameOnBoard || undefined,
        nearestStationName: form.nearestStationName || undefined,
        distanceFromStationKm: form.distanceFromStationKm ? parseFloat(form.distanceFromStationKm) : undefined,
        nearestBusStopName: form.nearestBusStopName || undefined,
        distanceFromBusStopKm: form.distanceFromBusStopKm ? parseFloat(form.distanceFromBusStopKm) : undefined,
        distanceFromSchoolKm: form.distanceFromSchoolKm ? parseFloat(form.distanceFromSchoolKm) : undefined,
        distanceFromHospitalKm: form.distanceFromHospitalKm ? parseFloat(form.distanceFromHospitalKm) : undefined,
        observedBoundaries: form.observedBoundaries,
        groundFloorType: (form.groundFloorType || undefined) as 'GROUND' | 'STILT' | 'BASEMENT' | 'PODIUM' | 'STILT_PODIUM' | undefined,
        storeyHeightFt: form.storeyHeightFt ? parseFloat(form.storeyHeightFt) : undefined,
        flatsPerFloor: form.flatsPerFloor ? parseInt(form.flatsPerFloor) : undefined,
        numberOfWings: form.numberOfWings ? parseInt(form.numberOfWings) : undefined,
        numberOfLifts: form.numberOfLifts ? parseInt(form.numberOfLifts) : undefined,
        compoundWallGateType: form.compoundWallGateType || undefined,
        parkingType: form.parkingType || undefined,
        parkingCount: form.parkingCount ? parseInt(form.parkingCount) : undefined,
        constructionQuality: (form.constructionQuality || undefined) as 'GOOD' | 'AVERAGE' | 'POOR' | undefined,
        maintenanceCondition: (form.maintenanceCondition || undefined) as 'GOOD' | 'AVERAGE' | 'POOR' | undefined,
        neighborhoodType: form.neighborhoodType || undefined,
        approachRoadWidth: form.approachRoadWidth || undefined,
        documentsAvailableAtSite: form.documentsAvailableAtSite.length ? form.documentsAvailableAtSite : undefined,
        otherDocumentsNote: form.otherDocumentsNote || undefined,
        flooringType: form.flooringType || undefined,
        flooringExternal: form.flooringExternal || undefined,
        flooringStaircase: form.flooringStaircase || undefined,
        flooringLobby: form.flooringLobby || undefined,
        waterSupplyType: form.waterSupplyType || undefined,
        waterSupplyQuality: (form.waterSupplyQuality || undefined) as 'GOOD' | 'NORMAL' | 'POOR' | undefined,
        electrificationType: form.electrificationType || undefined,
        plumbingType: (form.plumbingType || undefined) as 'CONCEALED' | 'OPEN' | undefined,
        externalWallFinish: form.externalWallFinish || undefined,
        roofType: form.roofType || undefined,
        doorType: form.doorType || undefined,
        windowType: form.windowType || undefined,
        kitchenPlatformMaterial: form.kitchenPlatformMaterial || undefined,
        wallFinishing: form.wallFinishing || undefined,
        ceilingHeightFt: form.ceilingHeightFt ? parseFloat(form.ceilingHeightFt) : undefined,
        electricalFittings: form.electricalFittings || undefined,
        sanitaryFittings: form.sanitaryFittings || undefined,
        leaseholdDetails: form.leaseholdDetails || undefined,
        amenities: form.amenities,
        numberOfRooms: form.numberOfRooms ? parseInt(form.numberOfRooms) : undefined,
        numberOfToilets: form.numberOfToilets ? parseInt(form.numberOfToilets) : undefined,
        numberOfBalconies: form.numberOfBalconies ? parseInt(form.numberOfBalconies) : undefined,
        numberOfTerraces: form.numberOfTerraces ? parseInt(form.numberOfTerraces) : undefined,
        accommodationDescription: form.accommodationDescription || undefined,
        observedRateCarpet: form.observedRateCarpet ? parseFloat(form.observedRateCarpet) : undefined,
        observedRateSuba: form.observedRateSuba ? parseFloat(form.observedRateSuba) : undefined,
        inspectorValueEstimate: form.inspectorValueEstimate ? parseFloat(form.inspectorValueEstimate) : undefined,
        rccSlabCompleteFloor: form.rccSlabCompleteFloor || undefined,
        brickworkCompleteFloor: form.brickworkCompleteFloor || undefined,
        internalPlasterStatus: (form.internalPlasterStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        externalPlasterStatus: (form.externalPlasterStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        flooringWorkStatus: (form.flooringWorkStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        woodworkStatus: (form.woodworkStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        internalPaintingStatus: (form.internalPaintingStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        externalPaintingStatus: (form.externalPaintingStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        plumbingWorkStatus: (form.plumbingWorkStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        electrificationWorkStatus: (form.electrificationWorkStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        liftInstallationStatus: (form.liftInstallationStatus || undefined) as typeof LiftInstallationStatus[keyof typeof LiftInstallationStatus] | undefined,
        finalFinishingStatus: (form.finalFinishingStatus || undefined) as typeof ConstructionStageStatus[keyof typeof ConstructionStageStatus] | undefined,
        internalAccessAllowed: form.internalAccessAllowed === '' ? undefined : form.internalAccessAllowed === 'true',
        brokerName: form.brokerName || undefined,
        brokerPhone: form.brokerPhone || undefined,
        brokerFirmName: form.brokerFirmName || undefined,
        observationRemarks: form.observationRemarks || undefined,
        builtUpAreaActualSqFt: form.builtUpAreaActualSqFt ? parseFloat(form.builtUpAreaActualSqFt) : undefined,
        builtUpAreaActualSqM: form.builtUpAreaActualSqM ? parseFloat(form.builtUpAreaActualSqM) : undefined,
        carpetAreaActualSqFt: form.carpetAreaActualSqFt ? parseFloat(form.carpetAreaActualSqFt) : undefined,
        carpetAreaActualSqM: form.carpetAreaActualSqM ? parseFloat(form.carpetAreaActualSqM) : undefined,
        landAreaActualSqFt: form.landAreaActualSqFt ? parseFloat(form.landAreaActualSqFt) : undefined,
        landAreaActualSqM: form.landAreaActualSqM ? parseFloat(form.landAreaActualSqM) : undefined,
      },
    }, {
      onSuccess: () => toast({ title: 'Draft saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  function handleSubmit() {
    submit(assignmentId, {
      onSuccess: () => toast({ title: 'Inspection submitted' }),
      onError: (err: Error) => toast({ title: 'Submit failed', description: err.message, variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  const p = propertyData?.property;

  return (
    <div className="space-y-4">
      {/* Assign inspection (admin/valuer only, before inspection exists) */}
      {showAssignSection && (
        <SectionCard letter="!" title="Assign Inspector">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Inspector</Label>
              <Select value={assignForm.inspectorId} onValueChange={(v) => setAssignForm((a) => ({ ...a, inspectorId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select user…" /></SelectTrigger>
                <SelectContent>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Scheduled Date</Label>
              <Input type="date" value={assignForm.scheduledDate}
                onChange={(e) => setAssignForm((a) => ({ ...a, scheduledDate: e.target.value }))} />
            </div>
          </div>
          <Button disabled={!assignForm.inspectorId || assigning}
            onClick={() => assign({ assignmentId, data: { inspectorId: assignForm.inspectorId, scheduledDate: assignForm.scheduledDate || null } }, {
              onSuccess: () => toast({ title: 'Inspector assigned' }),
              onError: () => toast({ title: 'Assignment failed', variant: 'destructive' }),
            })}>
            <UserCheck className="h-4 w-4 mr-2" /> Assign Inspector
          </Button>
        </SectionCard>
      )}

      {/* Inspection exists */}
      {inspection && (
        <>
          {/* Completed banner */}
          {inspection.isComplete && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-md px-4 py-2 text-green-800 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Inspection submitted by {inspection.inspector?.fullName} on {inspection.submittedAt ? new Date(inspection.submittedAt).toLocaleDateString('en-IN') : '—'}
              {isAdmin && <span className="text-xs text-muted-foreground ml-2">(Admin can still edit)</span>}
            </div>
          )}

          {/* ── A: Assignment Header ────────────────────────────────── */}
          {canFillForm && (
            <SectionCard letter="A" title="Assignment Header">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Site Engineer</p>
                  <p className="font-medium">{inspection.inspector?.fullName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bank / Party</p>
                  <p className="font-medium">{bankName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Loan Type</p>
                  <p className="font-medium">{loanType?.replace(/_/g, ' ') ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Borrower / Applicant</p>
                  <p className="font-medium">{p?.borrowerName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Property Type</p>
                  <p className="font-medium">{propertyType.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scheduled Date</p>
                  <p className="font-medium">
                    {inspection.scheduledDate ? new Date(inspection.scheduledDate).toLocaleDateString('en-IN') : '—'}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="space-y-1 max-w-xs">
                <Label className="text-xs">Date of Inspection <span className="text-destructive">*</span></Label>
                <Input type="date" disabled={formDisabled} value={form.inspectionDate}
                  onChange={(e) => setForm((p) => ({ ...p, inspectionDate: e.target.value }))} />
              </div>
            </SectionCard>
          )}

          {/* ── B: Property Location (read-only reference) ────────── */}
          {canFillForm && p && (
            <SectionCard letter="B" title="Property Location (Reference)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-muted/30 p-3 rounded-md">
                {[
                  ['Full Address', [p.addressLine1, p.addressLine2].filter(Boolean).join(', ')],
                  ['Locality / Village', [p.village, p.addressLine1].filter(Boolean)[0]],
                  ['Approach Road', p.streetName],
                  ['Nearest Landmark', p.landmark],
                  ['Survey / CTS / Plot No', [p.surveyNo, p.ctsSurveyNo, p.municipalNo].filter(Boolean).join(' / ')],
                  ['Flat / Unit No', p.flatNo],
                  ['Floor', p.floor != null ? String(p.floor) : null],
                  ['Wing / Tower', p.wingName],
                  ['Building / Society', [p.buildingName, p.societyName].filter(Boolean).join(' / ')],
                  ['Taluka', p.taluka],
                  ['District', p.district],
                  ['State', p.state],
                  ['Pincode', p.pincode],
                  ['GPS', p.latitude != null ? `${p.latitude}, ${p.longitude}` : null],
                ].map(([label, value]) => value ? (
                  <div key={label as string}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium text-xs leading-snug">{value}</p>
                  </div>
                ) : null)}
              </div>
              {p.latitude && p.longitude && (
                <a
                  href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <MapPin className="h-3 w-3" /> Open in Google Maps
                </a>
              )}
            </SectionCard>
          )}

          {/* Only show form if inspector can fill */}
          {canFillForm && (
            <>
              {/* ── C: Person Met at Site ──────────────────────────── */}
              <SectionCard letter="C" title="Person Met at Site">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Name of Person Met <span className="text-destructive">*</span></Label>
                    <Input disabled={formDisabled} value={f('propertyShownBy')}
                      onChange={(e) => setForm((p) => ({ ...p, propertyShownBy: e.target.value }))}
                      placeholder="Full name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Contact Number <span className="text-destructive">*</span></Label>
                    <Input disabled={formDisabled} value={f('propertyShownByPhone')}
                      onChange={(e) => setForm((p) => ({ ...p, propertyShownByPhone: e.target.value }))}
                      placeholder="Mobile number" />
                  </div>
                  <SelectField label="Relationship with Applicant *" value={f('propertyShownByDesignation')}
                    onChange={(v) => setForm((p) => ({ ...p, propertyShownByDesignation: v }))}
                    options={RELATIONSHIP_OPTIONS} disabled={formDisabled} required />
                </div>
              </SectionCard>

              {/* ── D: Property Status & Use ───────────────────────── */}
              <SectionCard letter="D" title="Property Status & Use">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <SelectField label="Use of Property *" value={f('useOfProperty')}
                    onChange={(v) => setForm((p) => ({ ...p, useOfProperty: v }))}
                    options={USE_OPTIONS} disabled={formDisabled} required />
                  <SelectField label="Occupancy Status *" value={f('occupancyStatus')}
                    onChange={(v) => setForm((p) => ({ ...p, occupancyStatus: v }))}
                    options={OCCUPANCY_OPTIONS} disabled={formDisabled} required />
                  <div className="space-y-1">
                    <Label className="text-xs">Occupant Name</Label>
                    <Input disabled={formDisabled} value={f('occupantName')}
                      onChange={(e) => setForm((p) => ({ ...p, occupantName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Relation to Owner</Label>
                    <Input disabled={formDisabled} value={f('occupantRelation')}
                      onChange={(e) => setForm((p) => ({ ...p, occupantRelation: e.target.value }))}
                      placeholder="Tenant / Caretaker" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Occupied Since</Label>
                    <Input disabled={formDisabled} value={f('occupiedSince')}
                      onChange={(e) => setForm((p) => ({ ...p, occupiedSince: e.target.value }))}
                      placeholder="e.g. Jan 2020" />
                  </div>
                </div>
                {hasUnit && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Unit No. as Displayed (SITE_008)</Label>
                      <Input disabled={formDisabled} value={f('flatNumberAsDisplayed')}
                        onChange={(e) => setForm((p) => ({ ...p, flatNumberAsDisplayed: e.target.value }))}
                        placeholder="Door name / number seen" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Society / Building Board Text (SITE_009)</Label>
                      <Input disabled={formDisabled} value={f('nameOnBoard')}
                        onChange={(e) => setForm((p) => ({ ...p, nameOnBoard: e.target.value }))}
                        placeholder="Text as seen on board" />
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ── E: Connectivity ──────────────────────────────────── */}
              <SectionCard letter="E" title="Connectivity & Proximity">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Nearest Station / Metro <span className="text-destructive">*</span></Label>
                    <Input disabled={formDisabled} value={f('nearestStationName')}
                      onChange={(e) => setForm((p) => ({ ...p, nearestStationName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Distance from Station (km) <span className="text-destructive">*</span></Label>
                    <Input disabled={formDisabled} type="number" step="0.1" value={f('distanceFromStationKm')}
                      onChange={(e) => setForm((p) => ({ ...p, distanceFromStationKm: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nearest Bus Stop</Label>
                    <Input disabled={formDisabled} value={f('nearestBusStopName')}
                      onChange={(e) => setForm((p) => ({ ...p, nearestBusStopName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bus Stop Distance (km)</Label>
                    <Input disabled={formDisabled} type="number" step="0.1" value={f('distanceFromBusStopKm')}
                      onChange={(e) => setForm((p) => ({ ...p, distanceFromBusStopKm: e.target.value }))} />
                  </div>
                  {isFlat && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Distance from School (km) <span className="text-destructive">*</span></Label>
                        <Input disabled={formDisabled} type="number" step="0.1" value={f('distanceFromSchoolKm')}
                          onChange={(e) => setForm((p) => ({ ...p, distanceFromSchoolKm: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Distance from Hospital (km) <span className="text-destructive">*</span></Label>
                        <Input disabled={formDisabled} type="number" step="0.1" value={f('distanceFromHospitalKm')}
                          onChange={(e) => setForm((p) => ({ ...p, distanceFromHospitalKm: e.target.value }))} />
                      </div>
                    </>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Approach Road / Street Name</Label>
                    <Input disabled={formDisabled} value={f('approachRoadWidth')}
                      onChange={(e) => setForm((p) => ({ ...p, approachRoadWidth: e.target.value }))}
                      placeholder="e.g. 9m wide / NH8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Neighbourhood Type</Label>
                    <Input disabled={formDisabled} value={f('neighborhoodType')}
                      onChange={(e) => setForm((p) => ({ ...p, neighborhoodType: e.target.value }))}
                      placeholder="Residential / Commercial / Mixed" />
                  </div>
                </div>
              </SectionCard>

              {/* ── F: Boundaries as Observed ─────────────────────── */}
              <SectionCard letter="F" title="Boundaries as Observed at Site">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Building / Plot Boundaries</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(['north', 'south', 'east', 'west'] as const).map((dir) => (
                      <div key={dir} className="space-y-1">
                        <Label className="text-xs capitalize">{dir} Boundary</Label>
                        <Input disabled={formDisabled}
                          value={form.observedBoundaries[dir]}
                          onChange={(e) => setForm((p) => ({ ...p, observedBoundaries: { ...p.observedBoundaries, [dir]: e.target.value } }))}
                          placeholder={`e.g. ${dir === 'north' ? 'Main Road' : dir === 'south' ? 'Plot No. 22' : dir === 'east' ? 'Open land' : 'Neighbour property'}`}
                        />
                      </div>
                    ))}
                  </div>
                  {hasUnit && (
                    <>
                      <Separator />
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Flat / Unit Boundaries (Optional)</p>
                      <div className="grid grid-cols-2 gap-3">
                        {([['unitNorth', 'North'], ['unitSouth', 'South'], ['unitEast', 'East'], ['unitWest', 'West']] as const).map(([key, label]) => (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs">{label} (Unit)</Label>
                            <Input disabled={formDisabled}
                              value={form.observedBoundaries[key]}
                              onChange={(e) => setForm((p) => ({ ...p, observedBoundaries: { ...p.observedBoundaries, [key]: e.target.value } }))}
                              placeholder={`e.g. ${label === 'North' ? 'Flat 402' : label === 'South' ? 'Staircase' : 'Corridor'}`}
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </SectionCard>

              {/* ── G: Building Details ──────────────────────────────── */}
              {!isLand && (
                <SectionCard letter="G" title="Building Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <SelectField label="Ground Floor Type *" value={f('groundFloorType')}
                      onChange={(v) => setForm((p) => ({ ...p, groundFloorType: v }))}
                      options={GROUND_FLOOR_OPTIONS} disabled={formDisabled} required />
                    <div className="space-y-1">
                      <Label className="text-xs">Total No. of Floors (G+?) <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} type="number" value={f('flatsPerFloor') /* reuse for display */}
                        placeholder="e.g. 12 (for G+12)"
                        onChange={(e) => setForm((p) => ({ ...p, flatsPerFloor: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Wings / Towers</Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfWings')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfWings: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Lifts</Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfLifts')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfLifts: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Storey Height (ft)</Label>
                      <Input disabled={formDisabled} type="number" step="0.5" value={f('storeyHeightFt')}
                        onChange={(e) => setForm((p) => ({ ...p, storeyHeightFt: e.target.value }))} />
                    </div>
                    <SelectField label="Parking Type *" value={f('parkingType')}
                      onChange={(v) => setForm((p) => ({ ...p, parkingType: v }))}
                      options={PARKING_OPTIONS} disabled={formDisabled} required />
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Parking Spaces</Label>
                      <Input disabled={formDisabled} type="number" value={f('parkingCount')}
                        onChange={(e) => setForm((p) => ({ ...p, parkingCount: e.target.value }))} />
                    </div>
                    <SelectField label="Compound Wall / Gate Type *" value={f('compoundWallGateType')}
                      onChange={(v) => setForm((p) => ({ ...p, compoundWallGateType: v }))}
                      options={COMPOUND_WALL_OPTIONS} disabled={formDisabled} required />
                    <div className="space-y-1">
                      <Label className="text-xs">Overall Maintenance Condition <span className="text-destructive">*</span></Label>
                      <div className="flex gap-3 mt-1">
                        {(['GOOD', 'AVERAGE', 'POOR'] as const).map((q) => (
                          <label key={q} className="flex items-center gap-1.5 cursor-pointer text-sm">
                            <input type="radio" name={`mc-${assignmentId}`} disabled={formDisabled}
                              checked={form.maintenanceCondition === q}
                              onChange={() => setForm((p) => ({ ...p, maintenanceCondition: q }))} />
                            {q.charAt(0) + q.slice(1).toLowerCase()}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* Reference from property data */}
                  {p && (p.structureType || p.yearOfConstruction || p.ageOfBuilding) && (
                    <div className="bg-muted/30 rounded p-2 text-xs text-muted-foreground flex gap-4 flex-wrap">
                      <span>From documents: </span>
                      {p.structureType && <span>Structure: <strong>{p.structureType}</strong></span>}
                      {p.yearOfConstruction && <span>Year: <strong>{p.yearOfConstruction}</strong></span>}
                      {p.ageOfBuilding && <span>Age: <strong>{p.ageOfBuilding} yrs</strong></span>}
                    </div>
                  )}
                </SectionCard>
              )}

              {/* ── H: Documents Available at Site ───────────────────── */}
              <SectionCard letter="H" title="Documents Available at Site (Tick all seen)">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {DOCUMENTS_AT_SITE_OPTIONS.map((doc) => (
                    <label key={doc} className="flex items-start gap-2 cursor-pointer text-sm">
                      <Checkbox
                        disabled={formDisabled}
                        checked={form.documentsAvailableAtSite.includes(doc)}
                        onCheckedChange={() => !formDisabled && toggleDoc(doc)}
                        className="mt-0.5"
                      />
                      <span className="leading-snug">{doc}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Other Documents (specify)</Label>
                  <Input disabled={formDisabled} value={f('otherDocumentsNote')}
                    onChange={(e) => setForm((p) => ({ ...p, otherDocumentsNote: e.target.value }))}
                    placeholder="Mention any other documents seen" />
                </div>
              </SectionCard>

              {/* ── I: Unit / Flat / Shop Details ────────────────────── */}
              {hasUnit && (
                <SectionCard letter="I" title="Unit / Flat / Shop Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Measured Carpet Area (Sq.Ft) <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} type="number" step="0.01" value={f('carpetAreaActualSqFt')}
                        onChange={(e) => handleCarpetSqFt(e.target.value)}
                        placeholder="Enter Sq.Ft — Sq.M auto-fills" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Carpet Area (Sq.M) — auto</Label>
                      <Input disabled value={f('carpetAreaActualSqM')} className="bg-muted/30" placeholder="Auto-calculated" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Built-up Area (Sq.Ft)</Label>
                      <Input disabled={formDisabled} type="number" step="0.01" value={f('builtUpAreaActualSqFt')}
                        onChange={(e) => {
                          const sqft = parseFloat(e.target.value);
                          setForm((p) => ({ ...p, builtUpAreaActualSqFt: e.target.value, builtUpAreaActualSqM: !isNaN(sqft) ? String((sqft * 0.0929).toFixed(2)) : '' }));
                        }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Built-up Area (Sq.M) — auto</Label>
                      <Input disabled value={f('builtUpAreaActualSqM')} className="bg-muted/30" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Rooms (excl. kitchen & bath) <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfRooms')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfRooms: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Toilets / Bathrooms <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfToilets')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfToilets: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Balconies</Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfBalconies')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfBalconies: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. of Terraces</Label>
                      <Input disabled={formDisabled} type="number" value={f('numberOfTerraces')}
                        onChange={(e) => setForm((p) => ({ ...p, numberOfTerraces: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Accommodation — Full Description <span className="text-destructive">*</span></Label>
                    <Textarea disabled={formDisabled} rows={2} value={f('accommodationDescription')}
                      onChange={(e) => setForm((p) => ({ ...p, accommodationDescription: e.target.value }))}
                      placeholder="e.g. 2BHK: Hall, 2 Bedrooms, Kitchen, 2 Toilets, 1 Balcony" />
                  </div>
                </SectionCard>
              )}

              {/* Land area */}
              {isLand && (
                <SectionCard letter="I" title="Land Measurements (as Observed)">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Land Area (Sq.Ft)</Label>
                      <Input disabled={formDisabled} type="number" step="0.01" value={f('landAreaActualSqFt')}
                        onChange={(e) => {
                          const sqft = parseFloat(e.target.value);
                          setForm((p) => ({ ...p, landAreaActualSqFt: e.target.value, landAreaActualSqM: !isNaN(sqft) ? String((sqft * 0.0929).toFixed(2)) : '' }));
                        }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Land Area (Sq.M) — auto</Label>
                      <Input disabled value={f('landAreaActualSqM')} className="bg-muted/30" />
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* ── J: Finishes & Specifications ─────────────────────── */}
              {!isLand && (
                <SectionCard letter="J" title="Finishes & Specifications">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <SelectField label="Flooring — Unit Interior *" value={f('flooringType')}
                      onChange={(v) => setForm((p) => ({ ...p, flooringType: v }))}
                      options={FLOORING_UNIT_OPTIONS} disabled={formDisabled} required />
                    <SelectField label="Flooring — External / Around Building" value={f('flooringExternal')}
                      onChange={(v) => setForm((p) => ({ ...p, flooringExternal: v }))}
                      options={FLOORING_EXT_OPTIONS} disabled={formDisabled} />
                    <SelectField label="Flooring — Staircase & Lobby" value={f('flooringStaircase')}
                      onChange={(v) => setForm((p) => ({ ...p, flooringStaircase: v }))}
                      options={FLOORING_STAIR_OPTIONS} disabled={formDisabled} />
                    <SelectField label="Flooring — Building Lobby (GF)" value={f('flooringLobby')}
                      onChange={(v) => setForm((p) => ({ ...p, flooringLobby: v }))}
                      options={FLOORING_LOBBY_OPTIONS} disabled={formDisabled} />
                    <SelectField label="Water Supply Type *" value={f('waterSupplyType')}
                      onChange={(v) => setForm((p) => ({ ...p, waterSupplyType: v }))}
                      options={WATER_SUPPLY_OPTIONS} disabled={formDisabled} required />
                    <SelectField label="Water Supply Appearance" value={f('waterSupplyQuality')}
                      onChange={(v) => setForm((p) => ({ ...p, waterSupplyQuality: v }))}
                      options={['GOOD', 'NORMAL', 'POOR'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))}
                      disabled={formDisabled} />
                    <SelectField label="Electrification Type *" value={f('electrificationType')}
                      onChange={(v) => setForm((p) => ({ ...p, electrificationType: v }))}
                      options={ELECTRIFICATION_OPTIONS} disabled={formDisabled} required />
                    <SelectField label="Plumbing Type *" value={f('plumbingType')}
                      onChange={(v) => setForm((p) => ({ ...p, plumbingType: v }))}
                      options={[{ value: 'CONCEALED', label: 'Concealed' }, { value: 'OPEN', label: 'Open' }]}
                      disabled={formDisabled} required />
                    <SelectField label="External Wall Finish *" value={f('externalWallFinish')}
                      onChange={(v) => setForm((p) => ({ ...p, externalWallFinish: v }))}
                      options={EXT_WALL_OPTIONS} disabled={formDisabled} required />
                    <SelectField label="Terrace / Roof Type" value={f('roofType')}
                      onChange={(v) => setForm((p) => ({ ...p, roofType: v }))}
                      options={ROOF_OPTIONS} disabled={formDisabled} />
                    <SelectField label="Door Type *" value={f('doorType')}
                      onChange={(v) => setForm((p) => ({ ...p, doorType: v }))}
                      options={DOOR_OPTIONS} disabled={formDisabled} required />
                    <SelectField label="Window Type *" value={f('windowType')}
                      onChange={(v) => setForm((p) => ({ ...p, windowType: v }))}
                      options={WINDOW_OPTIONS} disabled={formDisabled} required />
                    {isFlat && (
                      <SelectField label="Kitchen Platform Material *" value={f('kitchenPlatformMaterial')}
                        onChange={(v) => setForm((p) => ({ ...p, kitchenPlatformMaterial: v }))}
                        options={KITCHEN_OPTIONS} disabled={formDisabled} required />
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Wall Finishing</Label>
                      <Input disabled={formDisabled} value={f('wallFinishing')}
                        onChange={(e) => setForm((p) => ({ ...p, wallFinishing: e.target.value }))}
                        placeholder="Painted / Texture / Tile / Bare" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Ceiling Height (ft)</Label>
                      <Input disabled={formDisabled} type="number" step="0.5" value={f('ceilingHeightFt')}
                        onChange={(e) => setForm((p) => ({ ...p, ceilingHeightFt: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Electrical Fittings</Label>
                      <Input disabled={formDisabled} value={f('electricalFittings')}
                        onChange={(e) => setForm((p) => ({ ...p, electricalFittings: e.target.value }))}
                        placeholder="Standard / Good / Industrial" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Sanitary Fittings</Label>
                      <Input disabled={formDisabled} value={f('sanitaryFittings')}
                        onChange={(e) => setForm((p) => ({ ...p, sanitaryFittings: e.target.value }))}
                        placeholder="Standard / Good / Imported" />
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* ── K: Amenities ──────────────────────────────────────── */}
              {!isLand && (
                <SectionCard letter="K" title="Amenities Available at Project">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {AMENITY_ITEMS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox
                          id={`am-${key}`}
                          disabled={formDisabled}
                          checked={form.amenities[key] as boolean ?? false}
                          onCheckedChange={(v) => setForm((p) => ({ ...p, amenities: { ...p.amenities, [key]: !!v } }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Other Amenities (specify)</Label>
                    <Input disabled={formDisabled}
                      value={(form.amenities.amenitiesOther as string | undefined) ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, amenities: { ...p.amenities, amenitiesOther: e.target.value } }))}
                      placeholder="List any other amenities" />
                  </div>
                </SectionCard>
              )}

              {/* ── L: Area & Rate Observations ──────────────────────── */}
              <SectionCard letter="L" title="Area & Rate Observations">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {hasUnit && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Observed Market Rate — Carpet (₹/Sq.Ft) <span className="text-destructive">*</span></Label>
                        <Input disabled={formDisabled} type="number" value={f('observedRateCarpet')}
                          onChange={(e) => setForm((p) => ({ ...p, observedRateCarpet: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Observed Rate — SUBA (₹/Sq.Ft)</Label>
                        <Input disabled={formDisabled} type="number" value={f('observedRateSuba')}
                          onChange={(e) => setForm((p) => ({ ...p, observedRateSuba: e.target.value }))} />
                      </div>
                    </>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Inspector Rough Estimate (₹) — Internal</Label>
                    <Input disabled={formDisabled} type="number" value={f('inspectorValueEstimate')}
                      onChange={(e) => setForm((p) => ({ ...p, inspectorValueEstimate: e.target.value }))} />
                  </div>
                </div>
              </SectionCard>

              {/* ── M: UC Progress ───────────────────────────────────── */}
              {isUC && (
                <SectionCard letter="M" title="Under Construction Progress">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">RCC / Structural Slab — Completed up to Floor No. <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} value={f('rccSlabCompleteFloor')}
                        onChange={(e) => setForm((p) => ({ ...p, rccSlabCompleteFloor: e.target.value }))}
                        placeholder="e.g. 18th floor" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Brickwork — Completed up to Floor No. <span className="text-destructive">*</span></Label>
                      <Input disabled={formDisabled} value={f('brickworkCompleteFloor')}
                        onChange={(e) => setForm((p) => ({ ...p, brickworkCompleteFloor: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {([
                      ['internalPlasterStatus', 'Internal Plaster', true],
                      ['externalPlasterStatus', 'External Plaster', true],
                      ['flooringWorkStatus', 'Flooring', false],
                      ['woodworkStatus', 'Woodwork', false],
                      ['internalPaintingStatus', 'Internal Painting', false],
                      ['externalPaintingStatus', 'External Painting', false],
                      ['plumbingWorkStatus', 'Plumbing', false],
                      ['electrificationWorkStatus', 'Electrification', false],
                      ['finalFinishingStatus', 'Final Finishing', false],
                    ] as Array<[string, string, boolean]>).map(([field, label, req]) => (
                      <SelectField key={field} label={`${label}${req ? ' *' : ''}`} value={f(field as keyof typeof form)}
                        onChange={(v) => setForm((p) => ({ ...p, [field]: v }))}
                        options={STAGE_STATUS_OPTIONS} disabled={formDisabled} required={req} />
                    ))}
                    <div className="space-y-1">
                      <Label className="text-xs">Lift Installation</Label>
                      <Select disabled={formDisabled} value={f('liftInstallationStatus') || '_none'}
                        onValueChange={(v) => setForm((p) => ({ ...p, liftInstallationStatus: v === '_none' ? '' : v }))}>
                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">— Select —</SelectItem>
                          <SelectItem value={LiftInstallationStatus.INSTALLED}>Installed</SelectItem>
                          <SelectItem value={LiftInstallationStatus.IN_PROGRESS}>In Progress</SelectItem>
                          <SelectItem value={LiftInstallationStatus.NOT_STARTED}>Not Started</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Was Internal Site Access Allowed? <span className="text-destructive">*</span></Label>
                    <div className="flex gap-4 mt-1">
                      {[{ v: 'true', l: 'Yes' }, { v: 'false', l: 'No' }].map(({ v, l }) => (
                        <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                          <input type="radio" name={`iac-${assignmentId}`} disabled={formDisabled}
                            checked={form.internalAccessAllowed === v}
                            onChange={() => setForm((p) => ({ ...p, internalAccessAllowed: v as 'true' | 'false' }))} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* ── N: Broker Details ─────────────────────────────────── */}
              <SectionCard letter="N" title="Broker / Agent Details (if applicable)">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Broker / Agent Name</Label>
                    <Input disabled={formDisabled} value={f('brokerName')}
                      onChange={(e) => setForm((p) => ({ ...p, brokerName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Broker Contact Number</Label>
                    <Input disabled={formDisabled} value={f('brokerPhone')}
                      onChange={(e) => setForm((p) => ({ ...p, brokerPhone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Broker Firm Name</Label>
                    <Input disabled={formDisabled} value={f('brokerFirmName')}
                      onChange={(e) => setForm((p) => ({ ...p, brokerFirmName: e.target.value }))} />
                  </div>
                </div>
              </SectionCard>

              {/* ── O: Site Photos ────────────────────────────────────── */}
              <SectionCard letter="O" title="Site Photographs">
                <CardHeader className="p-0 pb-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">★ = Compulsory photo. Upload all photos at site.</p>
                    {canFillForm && !formDisabled && (
                      <label className="cursor-pointer">
                        <Button asChild size="sm" variant="outline" disabled={uploadingCount > 0}>
                          <span>
                            <Upload className="h-4 w-4 mr-1" />
                            {uploadingCount > 0 ? `Uploading (${uploadingCount})…` : 'Upload Photos'}
                          </span>
                        </Button>
                        <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handlePhotoUpload} />
                      </label>
                    )}
                  </div>
                </CardHeader>
                {canFillForm && !formDisabled && (
                  <div className="flex gap-2 items-center">
                    <Label className="text-xs text-muted-foreground shrink-0">Category:</Label>
                    <Select value={photoCategory} onValueChange={setPhotoCategory}>
                      <SelectTrigger className="w-56 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PHOTO_CATEGORY_LABELS).map(([val, label]) => (
                          <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {inspectionPhotos.map((doc) => (
                    <div key={doc.id} className="relative group rounded border overflow-hidden bg-muted aspect-square">
                      <a href={doc.signedUrl ?? '#'} target="_blank" rel="noreferrer" className="block h-full">
                        {doc.mimeType?.startsWith('image/') ? (
                          <img src={doc.signedUrl ?? ''} alt={doc.originalName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full p-2">
                            <FileDown className="h-6 w-6 text-muted-foreground" />
                            <p className="text-xs text-center text-muted-foreground mt-1 break-all leading-tight">{doc.originalName}</p>
                          </div>
                        )}
                      </a>
                      {doc.photoCategory && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
                          {PHOTO_CATEGORY_LABELS[doc.photoCategory] ?? doc.photoCategory}
                        </div>
                      )}
                      {canFillForm && !formDisabled && (
                        <button
                          className="absolute top-1 right-1 bg-white/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => deleteDoc({ id: doc.id, assignmentId }, {
                            onSuccess: () => toast({ title: 'Photo deleted' }),
                          })}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      )}
                    </div>
                  ))}
                  {inspectionPhotos.length === 0 && (
                    <div className="col-span-4 text-sm text-muted-foreground text-center py-6">
                      No photos uploaded yet.
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* ── P: Floor Plan Sketch ──────────────────────────────── */}
              <SectionCard letter="P" title="Floor Plan / Sketch ★ COMPULSORY">
                <div className="flex items-center gap-3">
                  <p className="text-xs text-muted-foreground flex-1">
                    Draw a dimensioned sketch at site (room names, L×W, door/window positions, N-S-E-W orientation).
                    Upload photo of the hand-drawn sketch.
                  </p>
                  {canFillForm && !formDisabled && (
                    <label className="cursor-pointer shrink-0">
                      <Button asChild size="sm" variant="outline">
                        <span><Upload className="h-4 w-4 mr-1" /> Upload Sketch</span>
                      </Button>
                      <input type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          uploadPhoto({ assignmentId, file, documentType: 'INSPECTION_PHOTO', photoCategory: PhotoCategory.FLOOR_PLAN_SKETCH }, {
                            onSuccess: () => toast({ title: 'Sketch uploaded' }),
                            onError: () => toast({ title: 'Upload failed', variant: 'destructive' }),
                          });
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                {inspectionPhotos.filter((d) => d.photoCategory === PhotoCategory.FLOOR_PLAN_SKETCH).map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 border rounded p-2 text-sm">
                    <a href={doc.signedUrl ?? '#'} target="_blank" rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 flex-1">
                      <FileDown className="h-4 w-4" />{doc.originalName}
                    </a>
                    {canFillForm && !formDisabled && (
                      <button onClick={() => deleteDoc({ id: doc.id, assignmentId }, { onSuccess: () => toast({ title: 'Deleted' }) })}>
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                ))}
              </SectionCard>

              {/* ── Q: Remarks ───────────────────────────────────────── */}
              <SectionCard letter="Q" title="Remarks & Observations">
                <Textarea disabled={formDisabled} rows={4} value={f('observationRemarks')}
                  onChange={(e) => setForm((p) => ({ ...p, observationRemarks: e.target.value }))}
                  placeholder="Note anything unusual: encroachments, disputed possession, unauthorized construction, structural defects, seepage, sealed property, refused access, discrepancies between site and documents…" />
              </SectionCard>

              {/* ── Pre-submit checklist ─────────────────────────────── */}
              {canFillForm && !formDisabled && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
                  <p className="font-semibold mb-1">✓ Checklist before submitting:</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                    {['GPS captured (Section B)', 'Hand-drawn sketch uploaded (Section P)', 'All ★ mandatory photos taken (Section O)',
                      'Documents checklist ticked (Section H)', 'Measurements recorded (Section I)', 'Inspection date set (Section A)'].map((item) => (
                      <span key={item} className="flex items-center gap-1">☐ {item}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Save / Submit */}
              {canFillForm && !formDisabled && (
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" disabled={updating} onClick={handleSaveDraft}>
                    <Save className="h-4 w-4 mr-2" />
                    {updating ? 'Saving…' : 'Save Draft'}
                  </Button>
                  <Button disabled={submitting || !form.inspectionDate} onClick={handleSubmit}>
                    <Send className="h-4 w-4 mr-2" />
                    {submitting ? 'Submitting…' : 'Submit Inspection'}
                  </Button>
                </div>
              )}

              {/* Admin re-assign */}
              {(isAdmin || isValuer) && inspection && (
                <details className="border rounded-md">
                  <summary className="cursor-pointer px-4 py-2 text-sm text-muted-foreground select-none">Re-assign Inspector / Change Date</summary>
                  <div className="p-4 grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Inspector</Label>
                      <Select value={assignForm.inspectorId} onValueChange={(v) => setAssignForm((a) => ({ ...a, inspectorId: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {(users ?? []).map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Scheduled Date</Label>
                      <Input type="date" value={assignForm.scheduledDate}
                        onChange={(e) => setAssignForm((a) => ({ ...a, scheduledDate: e.target.value }))} />
                    </div>
                    <Button size="sm" disabled={!assignForm.inspectorId || assigning}
                      onClick={() => assign({ assignmentId, data: { inspectorId: assignForm.inspectorId, scheduledDate: assignForm.scheduledDate || null } }, {
                        onSuccess: () => { toast({ title: 'Inspector re-assigned' }); setAssignForm({ inspectorId: '', scheduledDate: '' }); },
                        onError: () => toast({ title: 'Failed', variant: 'destructive' }),
                      })}>
                      <UserCheck className="h-4 w-4 mr-2" /> Re-assign
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}

          {/* Inspector assigned but current user can't fill */}
          {!canFillForm && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Assigned to: <strong>{inspection.inspector?.fullName}</strong></p>
              <p className="text-xs mt-1">
                Scheduled: {inspection.scheduledDate ? new Date(inspection.scheduledDate).toLocaleDateString('en-IN') : 'Not set'}
              </p>
            </div>
          )}
        </>
      )}

      {/* No inspection yet, non-admin */}
      {!inspection && !showAssignSection && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No inspection assigned yet.</p>
        </div>
      )}
    </div>
  );
}
