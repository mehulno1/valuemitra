/**
 * SiteVisitSection — INS_001–050 + photo upload (INS_051–062)
 * Full site inspection form: assignment, site visit, occupancy, quality, finishes,
 * distances, building characteristics, UC stages, measurements, broker, photos.
 * Data model: Inspection (saved via PATCH /inspections/:id)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { Separator } from '../../ui/separator.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Checkbox } from '../../ui/checkbox.js';
import {
  CheckCircle2, Upload, UserCheck, ClipboardCheck, Send, Save, FileDown, Trash2,
} from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useInspection, useAssignInspection, useUpdateInspection, useSubmitInspection } from '../../../api/hooks/useInspections.js';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../../api/hooks/useDocuments.js';
import { useUsers } from '../../../api/hooks/useUsers.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { useAuthStore } from '../../../stores/auth.store.js';
import { LoadingSpinner } from '../../shared/LoadingSpinner.js';
import { PhotoCategory, ConstructionStageStatus, LiftInstallationStatus } from '@valuemitra/shared';

const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  BUILDING_EXTERIOR: 'Building Exterior',
  ENTRANCE_DOOR: 'Entrance Door',
  SOCIETY_BOARD: 'Society Board',
  LIVING_ROOM: 'Living Room / Hall',
  KITCHEN: 'Kitchen',
  BEDROOM: 'Bedroom',
  TOILET_BATHROOM: 'Toilet / Bathroom',
  TERRACE_BALCONY: 'Terrace / Balcony',
  INTERIOR_GENERAL: 'Interior General',
  DAMAGE_DEFECTS: 'Damage / Defects',
  APPROACH_ROAD: 'Approach Road',
  FLOOR_PLAN_SKETCH: 'Floor Plan Sketch',
};

const STAGE_STATUS_OPTIONS = [
  { value: ConstructionStageStatus.COMPLETED, label: 'Completed' },
  { value: ConstructionStageStatus.IN_PROGRESS, label: 'In Progress' },
  { value: ConstructionStageStatus.NOT_STARTED, label: 'Not Started' },
];

interface Props {
  assignmentId: string;
  propertyType: string;
  bankCode: string | null;
  canEdit: boolean;
}

export function SiteVisitSection({ assignmentId, propertyType, bankCode: _bankCode, canEdit }: Props) {
  const { toast } = useToast();
  const { isInspector, isAdmin, isValuer } = usePermissions();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { data: inspection, isLoading } = useInspection(assignmentId);
  const { data: users } = useUsers(!isInspector);
  const { data: allDocs } = useDocuments(assignmentId);
  const { mutate: assign, isPending: assigning } = useAssignInspection();
  const { mutate: update, isPending: updating } = useUpdateInspection();
  const { mutate: submit, isPending: submitting } = useSubmitInspection();
  const { mutate: uploadPhoto } = useUploadDocument();
  const { mutate: deleteDoc } = useDeleteDocument();

  const isUC = propertyType === 'UC_FLAT';

  const [photoCategory, setPhotoCategory] = useState<string>(PhotoCategory.BUILDING_EXTERIOR);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [assignForm, setAssignForm] = useState({ inspectorId: '', scheduledDate: '' });

  // ── Inspection form state ────────────────────────────────
  const [form, setForm] = useState({
    // SITE_001–003
    inspectionDate: '',
    propertyShownBy: '',
    propertyShownByPhone: '',
    propertyShownByDesignation: '',
    // SITE_004–009: Occupancy
    occupancyStatus: '',
    occupantName: '',
    occupantRelation: '',
    occupiedSince: '',
    flatNumberDisplayed: false,
    flatNumberAsDisplayed: '',
    nameOnBoard: '',
    // INS_003–008: Distances
    nearestStationName: '',
    distanceFromStationKm: '',
    nearestBusStopName: '',
    distanceFromBusStopKm: '',
    distanceFromSchoolKm: '',
    distanceFromHospitalKm: '',
    // INS_009–013: Building characteristics
    groundFloorType: '',
    storeyHeightFt: '',
    flatsPerFloor: '',
    numberOfWings: '',
    numberOfLifts: '',
    // INS_014: Compound wall
    compoundWallGateType: '',
    // Construction quality & condition
    constructionQuality: '',
    maintenanceCondition: '',
    // Amenities
    amenities: { gym: false, club: false, pool: false, garden: false, security: false, intercom: false, generator: false, solarPower: false },
    // INS_015–027: Finishes
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
    doorsWindowsType: '',
    electricalFittings: '',
    sanitaryFittings: '',
    acType: '',
    leaseholdDetails: '',
    // INS_028–032: Room counts
    numberOfRooms: '',
    numberOfToilets: '',
    numberOfBalconies: '',
    numberOfTerraces: '',
    accommodationDescription: '',
    // INS_033–044: UC construction stages
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
    // INS_045–047: Rate observations (internal)
    observedRateCarpet: '',
    observedRateSuba: '',
    inspectorValueEstimate: '',
    // INS_048–050: Broker
    brokerName: '',
    brokerPhone: '',
    brokerFirmName: '',
    // Neighbourhood
    neighborhoodType: '',
    approachRoadWidth: '',
    observationRemarks: '',
    // Actual measurements
    builtUpAreaActualSqM: '',
    builtUpAreaActualSqFt: '',
    carpetAreaActualSqM: '',
    carpetAreaActualSqFt: '',
    landAreaActualSqM: '',
    landAreaActualSqFt: '',
  });

  // Populate form from inspection data
  useEffect(() => {
    if (!inspection) return;
    const i = inspection;
    setForm({
      inspectionDate: i.inspectionDate ? String(i.inspectionDate).slice(0, 10) : '',
      propertyShownBy: i.propertyShownBy ?? '',
      propertyShownByPhone: (i as { propertyShownByPhone?: string | null }).propertyShownByPhone ?? '',
      propertyShownByDesignation: i.propertyShownByDesignation ?? '',
      occupancyStatus: i.occupancyStatus ?? '',
      occupantName: i.occupantName ?? '',
      occupantRelation: i.occupantRelation ?? '',
      occupiedSince: i.occupiedSince ?? '',
      flatNumberDisplayed: i.flatNumberDisplayed ?? false,
      flatNumberAsDisplayed: i.flatNumberAsDisplayed ?? '',
      nameOnBoard: i.nameOnBoard ?? '',
      nearestStationName: i.nearestStationName ?? '',
      distanceFromStationKm: i.distanceFromStationKm != null ? String(i.distanceFromStationKm) : '',
      nearestBusStopName: i.nearestBusStopName ?? '',
      distanceFromBusStopKm: i.distanceFromBusStopKm != null ? String(i.distanceFromBusStopKm) : '',
      distanceFromSchoolKm: i.distanceFromSchoolKm != null ? String(i.distanceFromSchoolKm) : '',
      distanceFromHospitalKm: i.distanceFromHospitalKm != null ? String(i.distanceFromHospitalKm) : '',
      groundFloorType: i.groundFloorType ?? '',
      storeyHeightFt: i.storeyHeightFt != null ? String(i.storeyHeightFt) : '',
      flatsPerFloor: i.flatsPerFloor != null ? String(i.flatsPerFloor) : '',
      numberOfWings: i.numberOfWings != null ? String(i.numberOfWings) : '',
      numberOfLifts: i.numberOfLifts != null ? String(i.numberOfLifts) : '',
      compoundWallGateType: i.compoundWallGateType ?? '',
      constructionQuality: i.constructionQuality ?? '',
      maintenanceCondition: i.maintenanceCondition ?? '',
      amenities: (i.amenities as typeof form.amenities) ?? { gym: false, club: false, pool: false, garden: false, security: false, intercom: false, generator: false, solarPower: false },
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
      doorsWindowsType: i.doorsWindowsType ?? '',
      electricalFittings: i.electricalFittings ?? '',
      sanitaryFittings: i.sanitaryFittings ?? '',
      acType: i.acType ?? '',
      leaseholdDetails: i.leaseholdDetails ?? '',
      numberOfRooms: i.numberOfRooms != null ? String(i.numberOfRooms) : '',
      numberOfToilets: i.numberOfToilets != null ? String(i.numberOfToilets) : '',
      numberOfBalconies: i.numberOfBalconies != null ? String(i.numberOfBalconies) : '',
      numberOfTerraces: i.numberOfTerraces != null ? String(i.numberOfTerraces) : '',
      accommodationDescription: i.accommodationDescription ?? '',
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
      observedRateCarpet: i.observedRateCarpet != null ? String(i.observedRateCarpet) : '',
      observedRateSuba: i.observedRateSuba != null ? String(i.observedRateSuba) : '',
      inspectorValueEstimate: i.inspectorValueEstimate != null ? String(i.inspectorValueEstimate) : '',
      brokerName: i.brokerName ?? '',
      brokerPhone: i.brokerPhone ?? '',
      brokerFirmName: i.brokerFirmName ?? '',
      neighborhoodType: i.neighborhoodType ?? '',
      approachRoadWidth: i.approachRoadWidth ?? '',
      observationRemarks: i.observationRemarks ?? '',
      builtUpAreaActualSqM: i.builtUpAreaActualSqM != null ? String(i.builtUpAreaActualSqM) : '',
      builtUpAreaActualSqFt: i.builtUpAreaActualSqFt != null ? String(i.builtUpAreaActualSqFt) : '',
      carpetAreaActualSqM: i.carpetAreaActualSqM != null ? String(i.carpetAreaActualSqM) : '',
      carpetAreaActualSqFt: i.carpetAreaActualSqFt != null ? String(i.carpetAreaActualSqFt) : '',
      landAreaActualSqM: i.landAreaActualSqM != null ? String(i.landAreaActualSqM) : '',
      landAreaActualSqFt: i.landAreaActualSqFt != null ? String(i.landAreaActualSqFt) : '',
    });
  }, [inspection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAssignedInspector = inspection?.inspectorId === currentUserId;
  const canFillForm = isInspector || isAssignedInspector || isAdmin;
  const formDisabled = !canFillForm || (!!inspection?.isComplete && !isAdmin);
  const showAssignSection = (isAdmin || isValuer) && !inspection;

  // ── Photo upload ─────────────────────────────────────────
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

  // ── Save draft ───────────────────────────────────────────
  function handleSaveDraft() {
    update({
      assignmentId,
      data: {
        inspectionDate: form.inspectionDate || undefined,
        propertyShownBy: form.propertyShownBy || undefined,
        propertyShownByPhone: form.propertyShownByPhone || undefined,
        propertyShownByDesignation: form.propertyShownByDesignation || undefined,
        occupancyStatus: (form.occupancyStatus || undefined) as 'SELF_OCCUPIED' | 'TENANTED' | 'VACANT' | 'PARTIALLY_VACANT' | undefined,
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
        groundFloorType: (form.groundFloorType || undefined) as 'GROUND' | 'STILT' | 'BASEMENT' | 'PODIUM' | 'STILT_PODIUM' | undefined,
        storeyHeightFt: form.storeyHeightFt ? parseFloat(form.storeyHeightFt) : undefined,
        flatsPerFloor: form.flatsPerFloor ? parseInt(form.flatsPerFloor) : undefined,
        numberOfWings: form.numberOfWings ? parseInt(form.numberOfWings) : undefined,
        numberOfLifts: form.numberOfLifts ? parseInt(form.numberOfLifts) : undefined,
        compoundWallGateType: form.compoundWallGateType || undefined,
        constructionQuality: (form.constructionQuality || undefined) as 'GOOD' | 'AVERAGE' | 'POOR' | undefined,
        maintenanceCondition: (form.maintenanceCondition || undefined) as 'GOOD' | 'AVERAGE' | 'POOR' | undefined,
        amenities: form.amenities,
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
        doorsWindowsType: form.doorsWindowsType || undefined,
        electricalFittings: form.electricalFittings || undefined,
        sanitaryFittings: form.sanitaryFittings || undefined,
        acType: form.acType || undefined,
        leaseholdDetails: form.leaseholdDetails || undefined,
        numberOfRooms: form.numberOfRooms ? parseInt(form.numberOfRooms) : undefined,
        numberOfToilets: form.numberOfToilets ? parseInt(form.numberOfToilets) : undefined,
        numberOfBalconies: form.numberOfBalconies ? parseInt(form.numberOfBalconies) : undefined,
        numberOfTerraces: form.numberOfTerraces ? parseInt(form.numberOfTerraces) : undefined,
        accommodationDescription: form.accommodationDescription || undefined,
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
        observedRateCarpet: form.observedRateCarpet ? parseFloat(form.observedRateCarpet) : undefined,
        observedRateSuba: form.observedRateSuba ? parseFloat(form.observedRateSuba) : undefined,
        inspectorValueEstimate: form.inspectorValueEstimate ? parseFloat(form.inspectorValueEstimate) : undefined,
        brokerName: form.brokerName || undefined,
        brokerPhone: form.brokerPhone || undefined,
        brokerFirmName: form.brokerFirmName || undefined,
        neighborhoodType: form.neighborhoodType || undefined,
        approachRoadWidth: form.approachRoadWidth || undefined,
        observationRemarks: form.observationRemarks || undefined,
        builtUpAreaActualSqM: form.builtUpAreaActualSqM ? parseFloat(form.builtUpAreaActualSqM) : undefined,
        builtUpAreaActualSqFt: form.builtUpAreaActualSqFt ? parseFloat(form.builtUpAreaActualSqFt) : undefined,
        carpetAreaActualSqM: form.carpetAreaActualSqM ? parseFloat(form.carpetAreaActualSqM) : undefined,
        carpetAreaActualSqFt: form.carpetAreaActualSqFt ? parseFloat(form.carpetAreaActualSqFt) : undefined,
        landAreaActualSqM: form.landAreaActualSqM ? parseFloat(form.landAreaActualSqM) : undefined,
        landAreaActualSqFt: form.landAreaActualSqFt ? parseFloat(form.landAreaActualSqFt) : undefined,
      },
    }, {
      onSuccess: () => toast({ title: 'Draft saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  const f = form; // alias for brevity

  function stageSelect(field: keyof typeof form, isLift = false) {
    const options = isLift
      ? [{ value: LiftInstallationStatus.INSTALLED, label: 'Installed' }, { value: LiftInstallationStatus.IN_PROGRESS, label: 'In Progress' }, { value: LiftInstallationStatus.NOT_STARTED, label: 'Not Started' }]
      : STAGE_STATUS_OPTIONS;
    return (
      <Select
        disabled={formDisabled}
        value={(f[field] as string) || '_none'}
        onValueChange={(v) => setForm((s) => ({ ...s, [field]: v === '_none' ? '' : v }))}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">—</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="space-y-4">
      {/* Inspector assignment */}
      {showAssignSection && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> Assign Inspector</CardTitle>
            <CardDescription>Assign a user to conduct the site inspection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Inspector</Label>
                <Select value={assignForm.inspectorId} onValueChange={(v) => setAssignForm((p) => ({ ...p, inspectorId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a user…" /></SelectTrigger>
                  <SelectContent>
                    {(users ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.fullName} <span className="text-xs text-muted-foreground">({u.role})</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Scheduled Date</Label>
                <Input type="date" value={assignForm.scheduledDate} onChange={(e) => setAssignForm((p) => ({ ...p, scheduledDate: e.target.value }))} />
              </div>
            </div>
            <Button disabled={!assignForm.inspectorId || assigning}
              onClick={() => assign({ assignmentId, data: { inspectorId: assignForm.inspectorId, scheduledDate: assignForm.scheduledDate || undefined } }, {
                onSuccess: () => toast({ title: 'Inspector assigned' }),
                onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Assign failed', variant: 'destructive' }),
              })}>
              <UserCheck className="h-4 w-4 mr-2" />
              {assigning ? 'Assigning…' : 'Assign Inspector'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Re-assign option */}
      {isAdmin && inspection && !inspection.isComplete && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Reassign Inspector</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">New Inspector</Label>
                <Select value={assignForm.inspectorId} onValueChange={(v) => setAssignForm((p) => ({ ...p, inspectorId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {(users ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Scheduled Date</Label>
                <Input type="date" value={assignForm.scheduledDate} onChange={(e) => setAssignForm((p) => ({ ...p, scheduledDate: e.target.value }))} />
              </div>
              <Button size="sm" variant="outline" disabled={!assignForm.inspectorId || assigning}
                onClick={() => assign({ assignmentId, data: { inspectorId: assignForm.inspectorId, scheduledDate: assignForm.scheduledDate || undefined } }, {
                  onSuccess: () => toast({ title: 'Reassigned' }),
                  onError: () => toast({ title: 'Failed', variant: 'destructive' }),
                })}>
                {assigning ? 'Saving…' : 'Reassign'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inspection status */}
      {inspection && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Inspection</CardTitle>
              {inspection.isComplete
                ? <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" /> Submitted</Badge>
                : <Badge variant="secondary">In Progress</Badge>}
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Inspector: </span>{inspection.inspector?.fullName}</div>
            {inspection.scheduledDate && <div><span className="text-muted-foreground">Scheduled: </span>{new Date(inspection.scheduledDate).toLocaleDateString('en-IN')}</div>}
            {inspection.submittedAt && <div><span className="text-muted-foreground">Submitted: </span>{new Date(inspection.submittedAt).toLocaleDateString('en-IN')}</div>}
          </CardContent>
        </Card>
      )}

      {/* Inspection form */}
      {inspection && canFillForm && (
        <>
          {/* SITE_001–003: Site visit basics */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Site Visit Details (SITE_001–003)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Inspection Date *</Label>
                  <Input type="date" disabled={formDisabled} value={f.inspectionDate}
                    onChange={(e) => setForm((p) => ({ ...p, inspectionDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Property Shown By</Label>
                  <Input disabled={formDisabled} value={f.propertyShownBy}
                    onChange={(e) => setForm((p) => ({ ...p, propertyShownBy: e.target.value }))} placeholder="Name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Contact Phone</Label>
                  <Input disabled={formDisabled} value={f.propertyShownByPhone}
                    onChange={(e) => setForm((p) => ({ ...p, propertyShownByPhone: e.target.value }))} placeholder="Mobile" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Designation</Label>
                  <Input disabled={formDisabled} value={f.propertyShownByDesignation}
                    onChange={(e) => setForm((p) => ({ ...p, propertyShownByDesignation: e.target.value }))} placeholder="Owner / Tenant" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SITE_004–009: Occupancy */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Occupancy & Identification (SITE_004–009)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Occupancy Status</Label>
                  <Select disabled={formDisabled} value={f.occupancyStatus || '_none'}
                    onValueChange={(v) => setForm((p) => ({ ...p, occupancyStatus: v === '_none' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">—</SelectItem>
                      <SelectItem value="SELF_OCCUPIED">Self Occupied</SelectItem>
                      <SelectItem value="TENANTED">Tenanted</SelectItem>
                      <SelectItem value="VACANT">Vacant</SelectItem>
                      <SelectItem value="PARTIALLY_VACANT">Partially Vacant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Occupant Name</Label>
                  <Input disabled={formDisabled} value={f.occupantName}
                    onChange={(e) => setForm((p) => ({ ...p, occupantName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Relation</Label>
                  <Input disabled={formDisabled} value={f.occupantRelation}
                    onChange={(e) => setForm((p) => ({ ...p, occupantRelation: e.target.value }))} placeholder="Tenant / Caretaker" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Occupied Since</Label>
                  <Input disabled={formDisabled} value={f.occupiedSince}
                    onChange={(e) => setForm((p) => ({ ...p, occupiedSince: e.target.value }))} placeholder="e.g. Jan 2020" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox id="flatNumDisplayed" disabled={formDisabled} checked={f.flatNumberDisplayed}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, flatNumberDisplayed: !!v }))} />
                  <Label htmlFor="flatNumDisplayed" className="text-xs">Flat no. displayed?</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Flat No As Displayed</Label>
                  <Input disabled={formDisabled} value={f.flatNumberAsDisplayed}
                    onChange={(e) => setForm((p) => ({ ...p, flatNumberAsDisplayed: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Name on Board</Label>
                  <Input disabled={formDisabled} value={f.nameOnBoard}
                    onChange={(e) => setForm((p) => ({ ...p, nameOnBoard: e.target.value }))} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* INS_003–008: Distances */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Connectivity & Distances (INS_003–008)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Nearest Station</Label>
                  <Input disabled={formDisabled} value={f.nearestStationName}
                    onChange={(e) => setForm((p) => ({ ...p, nearestStationName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Distance (km)</Label>
                  <Input disabled={formDisabled} type="number" step="0.1" value={f.distanceFromStationKm}
                    onChange={(e) => setForm((p) => ({ ...p, distanceFromStationKm: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nearest Bus Stop</Label>
                  <Input disabled={formDisabled} value={f.nearestBusStopName}
                    onChange={(e) => setForm((p) => ({ ...p, nearestBusStopName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bus Stop Distance (km)</Label>
                  <Input disabled={formDisabled} type="number" step="0.1" value={f.distanceFromBusStopKm}
                    onChange={(e) => setForm((p) => ({ ...p, distanceFromBusStopKm: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Distance from School (km)</Label>
                  <Input disabled={formDisabled} type="number" step="0.1" value={f.distanceFromSchoolKm}
                    onChange={(e) => setForm((p) => ({ ...p, distanceFromSchoolKm: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Distance from Hospital (km)</Label>
                  <Input disabled={formDisabled} type="number" step="0.1" value={f.distanceFromHospitalKm}
                    onChange={(e) => setForm((p) => ({ ...p, distanceFromHospitalKm: e.target.value }))} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* INS_009–014: Building characteristics */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Building Characteristics (INS_009–014)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Ground Floor Type (INS_009)</Label>
                  <Select disabled={formDisabled} value={f.groundFloorType || '_none'}
                    onValueChange={(v) => setForm((p) => ({ ...p, groundFloorType: v === '_none' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">—</SelectItem>
                      <SelectItem value="GROUND">Ground</SelectItem>
                      <SelectItem value="STILT">Stilt</SelectItem>
                      <SelectItem value="BASEMENT">Basement</SelectItem>
                      <SelectItem value="PODIUM">Podium</SelectItem>
                      <SelectItem value="STILT_PODIUM">Stilt + Podium</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Storey Height (ft) (INS_010)</Label>
                  <Input disabled={formDisabled} type="number" step="0.5" value={f.storeyHeightFt}
                    onChange={(e) => setForm((p) => ({ ...p, storeyHeightFt: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Flats per Floor (INS_011)</Label>
                  <Input disabled={formDisabled} type="number" value={f.flatsPerFloor}
                    onChange={(e) => setForm((p) => ({ ...p, flatsPerFloor: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No. of Wings (INS_012)</Label>
                  <Input disabled={formDisabled} type="number" value={f.numberOfWings}
                    onChange={(e) => setForm((p) => ({ ...p, numberOfWings: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No. of Lifts (INS_013)</Label>
                  <Input disabled={formDisabled} type="number" value={f.numberOfLifts}
                    onChange={(e) => setForm((p) => ({ ...p, numberOfLifts: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Compound Wall / Gate (INS_014)</Label>
                  <Input disabled={formDisabled} value={f.compoundWallGateType}
                    onChange={(e) => setForm((p) => ({ ...p, compoundWallGateType: e.target.value }))}
                    placeholder="RCC / Barbed wire / Open" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Construction quality & neighbourhood */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quality & Neighbourhood</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs">Construction Quality</Label>
                  <div className="flex gap-4">
                    {(['GOOD', 'AVERAGE', 'POOR'] as const).map((q) => (
                      <label key={q} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" name={`cq-${assignmentId}`} disabled={formDisabled}
                          checked={f.constructionQuality === q}
                          onChange={() => setForm((p) => ({ ...p, constructionQuality: q }))} />
                        {q.charAt(0) + q.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Maintenance Condition</Label>
                  <div className="flex gap-4">
                    {(['GOOD', 'AVERAGE', 'POOR'] as const).map((q) => (
                      <label key={q} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input type="radio" name={`mc-${assignmentId}`} disabled={formDisabled}
                          checked={f.maintenanceCondition === q}
                          onChange={() => setForm((p) => ({ ...p, maintenanceCondition: q }))} />
                        {q.charAt(0) + q.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Neighbourhood Type</Label>
                  <Input disabled={formDisabled} value={f.neighborhoodType}
                    onChange={(e) => setForm((p) => ({ ...p, neighborhoodType: e.target.value }))}
                    placeholder="Residential / Commercial / Mixed" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Approach Road Width</Label>
                  <Input disabled={formDisabled} value={f.approachRoadWidth}
                    onChange={(e) => setForm((p) => ({ ...p, approachRoadWidth: e.target.value }))}
                    placeholder="e.g. 9 metres" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Amenities */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Amenities</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                {(['gym', 'club', 'pool', 'garden', 'security', 'intercom', 'generator', 'solarPower'] as const).map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`am-${key}`}
                      disabled={formDisabled}
                      checked={form.amenities[key] ?? false}
                      onCheckedChange={(v) => setForm((p) => ({ ...p, amenities: { ...p.amenities, [key]: !!v } }))}
                    />
                    <Label htmlFor={`am-${key}`} className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* INS_015–027: Finishes */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Finishes (INS_015–027)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  ['flooringType', 'Internal Flooring (INS_015)'],
                  ['flooringExternal', 'External Flooring (INS_016)'],
                  ['flooringStaircase', 'Staircase Flooring (INS_017)'],
                  ['flooringLobby', 'Lobby Flooring (INS_018)'],
                  ['waterSupplyType', 'Water Supply (INS_019)'],
                  ['electrificationType', 'Electrification (INS_021)'],
                  ['externalWallFinish', 'External Wall Finish (INS_023)'],
                  ['roofType', 'Roof Type (INS_024)'],
                  ['doorType', 'Door Type (INS_025)'],
                  ['windowType', 'Window Type (INS_026)'],
                  ['kitchenPlatformMaterial', 'Kitchen Platform (INS_027)'],
                  ['wallFinishing', 'Internal Wall Finish'],
                  ['electricalFittings', 'Electrical Fittings'],
                  ['sanitaryFittings', 'Sanitary Fittings'],
                  ['acType', 'AC Type'],
                ].map(([field, label]) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input disabled={formDisabled} value={f[field as keyof typeof f] as string}
                      onChange={(e) => setForm((p) => ({ ...p, [field!]: e.target.value }))} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Water Supply Quality (INS_020)</Label>
                  <Select disabled={formDisabled} value={(f.waterSupplyQuality || '_none')}
                    onValueChange={(v) => setForm((p) => ({ ...p, waterSupplyQuality: v === '_none' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">—</SelectItem>
                      <SelectItem value="GOOD">Good</SelectItem>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="POOR">Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Plumbing Type (INS_022)</Label>
                  <Select disabled={formDisabled} value={(f.plumbingType || '_none')}
                    onValueChange={(v) => setForm((p) => ({ ...p, plumbingType: v === '_none' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">—</SelectItem>
                      <SelectItem value="CONCEALED">Concealed</SelectItem>
                      <SelectItem value="OPEN">Open</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ceiling Height (ft)</Label>
                  <Input disabled={formDisabled} type="number" step="0.5" value={f.ceilingHeightFt}
                    onChange={(e) => setForm((p) => ({ ...p, ceilingHeightFt: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Leasehold Details</Label>
                <Textarea disabled={formDisabled} rows={2} value={f.leaseholdDetails}
                  onChange={(e) => setForm((p) => ({ ...p, leaseholdDetails: e.target.value }))} />
              </div>
            </CardContent>
          </Card>

          {/* INS_028–032: Room counts */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Accommodation (INS_028–032)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                {[
                  ['numberOfRooms', 'Rooms'],
                  ['numberOfToilets', 'Toilets'],
                  ['numberOfBalconies', 'Balconies'],
                  ['numberOfTerraces', 'Terraces'],
                ].map(([field, label]) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input disabled={formDisabled} type="number" value={f[field as keyof typeof f] as string}
                      onChange={(e) => setForm((p) => ({ ...p, [field!]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Accommodation Description</Label>
                <Textarea disabled={formDisabled} rows={2} value={f.accommodationDescription}
                  onChange={(e) => setForm((p) => ({ ...p, accommodationDescription: e.target.value }))}
                  placeholder="e.g. 2 BHK + 2 toilets, living room, kitchen" />
              </div>
            </CardContent>
          </Card>

          {/* INS_033–044: UC Construction stages (shown only for UC_FLAT) */}
          {isUC && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">UC Construction Stages (INS_033–044)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">RCC Slab Complete up to Floor (INS_033)</Label>
                    <Input disabled={formDisabled} value={f.rccSlabCompleteFloor}
                      onChange={(e) => setForm((p) => ({ ...p, rccSlabCompleteFloor: e.target.value }))}
                      placeholder="e.g. 5th floor" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Brickwork Complete up to Floor (INS_034)</Label>
                    <Input disabled={formDisabled} value={f.brickworkCompleteFloor}
                      onChange={(e) => setForm((p) => ({ ...p, brickworkCompleteFloor: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    ['internalPlasterStatus', 'Internal Plaster (INS_035)'],
                    ['externalPlasterStatus', 'External Plaster (INS_036)'],
                    ['flooringWorkStatus', 'Flooring Work (INS_037)'],
                    ['woodworkStatus', 'Woodwork (INS_038)'],
                    ['internalPaintingStatus', 'Internal Painting (INS_039)'],
                    ['externalPaintingStatus', 'External Painting (INS_040)'],
                    ['plumbingWorkStatus', 'Plumbing (INS_041)'],
                    ['electrificationWorkStatus', 'Electrification (INS_042)'],
                    ['finalFinishingStatus', 'Final Finishing (INS_044)'],
                  ].map(([field, label]) => (
                    <div key={field} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      {stageSelect(field as keyof typeof form)}
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-xs">Lift Installation (INS_043)</Label>
                    {stageSelect('liftInstallationStatus', true)}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actual site measurements */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Actual Site Measurements</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  ['builtUpAreaActualSqM', 'Built-Up (Sq.M.)'],
                  ['builtUpAreaActualSqFt', 'Built-Up (Sq.Ft.)'],
                  ['carpetAreaActualSqM', 'Carpet (Sq.M.)'],
                  ['carpetAreaActualSqFt', 'Carpet (Sq.Ft.)'],
                  ['landAreaActualSqM', 'Land (Sq.M.)'],
                  ['landAreaActualSqFt', 'Land (Sq.Ft.)'],
                ].map(([field, label]) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input disabled={formDisabled} type="number" step="0.01" value={f[field as keyof typeof f] as string}
                      onChange={(e) => setForm((p) => ({ ...p, [field!]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* INS_045–047: Rate observations (admin/valuer only) */}
          {(isAdmin || isValuer) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Inspector Rate Observations (INS_045–047) — Internal</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Observed Rate Carpet (₹/Sq.Ft.)</Label>
                    <Input disabled={formDisabled} type="number" value={f.observedRateCarpet}
                      onChange={(e) => setForm((p) => ({ ...p, observedRateCarpet: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Observed Rate Suba (₹/Sq.Ft.)</Label>
                    <Input disabled={formDisabled} type="number" value={f.observedRateSuba}
                      onChange={(e) => setForm((p) => ({ ...p, observedRateSuba: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Inspector Value Estimate (₹)</Label>
                    <Input disabled={formDisabled} type="number" value={f.inspectorValueEstimate}
                      onChange={(e) => setForm((p) => ({ ...p, inspectorValueEstimate: e.target.value }))} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* INS_048–050: Broker details */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Broker Details (INS_048–050)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Broker Name</Label>
                  <Input disabled={formDisabled} value={f.brokerName}
                    onChange={(e) => setForm((p) => ({ ...p, brokerName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Broker Phone</Label>
                  <Input disabled={formDisabled} value={f.brokerPhone}
                    onChange={(e) => setForm((p) => ({ ...p, brokerPhone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Broker Firm Name</Label>
                  <Input disabled={formDisabled} value={f.brokerFirmName}
                    onChange={(e) => setForm((p) => ({ ...p, brokerFirmName: e.target.value }))} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Observation remarks */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Observations & Remarks</CardTitle></CardHeader>
            <CardContent>
              <Textarea disabled={formDisabled} rows={4} value={f.observationRemarks}
                onChange={(e) => setForm((p) => ({ ...p, observationRemarks: e.target.value }))}
                placeholder="Additional observations during site visit" />
            </CardContent>
          </Card>

          {/* Photos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                Site Photos (INS_051–062)
                {canEdit && !formDisabled && (
                  <label className="cursor-pointer">
                    <Button asChild size="sm" variant="outline" disabled={uploadingCount > 0}>
                      <span>
                        <Upload className="h-4 w-4 mr-1" />
                        {uploadingCount > 0 ? `Uploading (${uploadingCount})…` : 'Upload Photos'}
                      </span>
                    </Button>
                    <input type="file" multiple accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  </label>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canEdit && !formDisabled && (
                <div className="flex gap-2 items-center">
                  <Label className="text-xs text-muted-foreground shrink-0">Category:</Label>
                  <Select value={photoCategory} onValueChange={setPhotoCategory}>
                    <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PHOTO_CATEGORY_LABELS).map(([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {inspectionPhotos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {inspectionPhotos.map((doc) => (
                    <div key={doc.id} className="border rounded overflow-hidden relative group">
                      <a href={doc.signedUrl ?? '#'} target="_blank" rel="noreferrer">
                        <img
                          src={doc.signedUrl ?? ''}
                          alt={doc.originalName}
                          className="w-full h-24 object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div className="p-1 text-xs truncate text-muted-foreground">{doc.originalName}</div>
                        {(doc as { photoCategory?: string }).photoCategory && (
                          <div className="px-1 pb-1 text-xs text-primary">{PHOTO_CATEGORY_LABELS[(doc as { photoCategory: string }).photoCategory] ?? (doc as { photoCategory: string }).photoCategory}</div>
                        )}
                      </a>
                      {canEdit && !formDisabled && (
                        <button
                          className="absolute top-1 right-1 bg-white/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => deleteDoc({ id: doc.id, assignmentId }, {
                            onSuccess: () => toast({ title: 'Photo deleted' }),
                            onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
                          })}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Save / Submit buttons */}
          {canEdit && !formDisabled && (
            <div className="flex gap-3 justify-end">
              <Button variant="outline" disabled={updating} onClick={handleSaveDraft}>
                <Save className="h-4 w-4 mr-2" />
                {updating ? 'Saving…' : 'Save Draft'}
              </Button>
              {!inspection.isComplete && (
                <Button disabled={submitting} onClick={() =>
                  submit(assignmentId, {
                    onSuccess: () => toast({ title: 'Inspection submitted!' }),
                    onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Submit failed', variant: 'destructive' }),
                  })}>
                  <Send className="h-4 w-4 mr-2" />
                  {submitting ? 'Submitting…' : 'Submit Inspection'}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
