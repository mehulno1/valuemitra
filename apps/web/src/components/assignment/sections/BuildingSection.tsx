/**
 * BuildingSection — BLDG_001–016
 * Building characteristics: structure, age, floors, year, completion status, plan compliance, amenities.
 * Data model: Property (saved via PATCH /property-data/:id)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
import { Button } from '../../ui/button.js';
import { Checkbox } from '../../ui/checkbox.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Save } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useSavePropertyData } from '../../../api/hooks/usePropertyData.js';
import type { PropertyDataResponse } from '../../../api/hooks/usePropertyData.js';
import { BuildingCompletionStatus } from '@valuemitra/shared';

interface Props {
  assignmentId: string;
  propertyType: string;
  propertyData: PropertyDataResponse | undefined;
  canEdit: boolean;
}

export function BuildingSection({ assignmentId, propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const isUC = propertyType === 'UC_FLAT';

  const [form, setForm] = useState({
    structureType: p?.structureType ?? '',               // BLDG_001
    numberOfFloors: p?.numberOfFloors != null ? String(p.numberOfFloors) : '', // BLDG_002
    yearOfConstruction: p?.yearOfConstruction != null ? String(p.yearOfConstruction) : '', // BLDG_003
    ageOfBuilding: p?.ageOfBuilding != null ? String(p.ageOfBuilding) : '', // BLDG_004
    remainingLifeYears: p?.remainingLifeYears != null ? String(p.remainingLifeYears) : '', // BLDG_005
    buildingCompletionStatus: (p as { buildingCompletionStatus?: string | null } | undefined)?.buildingCompletionStatus ?? '', // BLDG_006
    roofType: (p as { roofType?: string | null } | undefined)?.roofType ?? '',            // BLDG_007
    exteriorCondition: (p as { exteriorCondition?: string | null } | undefined)?.exteriorCondition ?? '', // BLDG_008
    interiorCondition: (p as { interiorCondition?: string | null } | undefined)?.interiorCondition ?? '', // BLDG_009
    // Building compliance
    approvedPlanAuthority: p?.approvedPlanAuthority ?? '',  // BLDG_010
    approvedPlanDate: p?.approvedPlanDate ? String(p.approvedPlanDate).slice(0, 10) : '', // BLDG_011
    approvedPlanNo: p?.approvedPlanNo ?? '',               // BLDG_012
    approvedPlanValidity: p?.approvedPlanValidity ? String(p.approvedPlanValidity).slice(0, 10) : '',
    planGenuinenessVerified: p?.planGenuinenessVerified ?? false, // BLDG_013
    unauthorizedConstruction: p?.unauthorizedConstruction ?? false, // BLDG_014
    unauthorizedConstructionNotes: p?.unauthorizedConstructionNotes ?? '',
    demolitionProceedings: p?.demolitionProceedings ?? false, // BLDG_015
    demolitionProceedingsNotes: p?.demolitionProceedingsNotes ?? '',
  });

  useEffect(() => {
    setForm({
      structureType: p?.structureType ?? '',
      numberOfFloors: p?.numberOfFloors != null ? String(p.numberOfFloors) : '',
      yearOfConstruction: p?.yearOfConstruction != null ? String(p.yearOfConstruction) : '',
      ageOfBuilding: p?.ageOfBuilding != null ? String(p.ageOfBuilding) : '',
      remainingLifeYears: p?.remainingLifeYears != null ? String(p.remainingLifeYears) : '',
      buildingCompletionStatus: (p as { buildingCompletionStatus?: string | null } | undefined)?.buildingCompletionStatus ?? '',
      roofType: (p as { roofType?: string | null } | undefined)?.roofType ?? '',
      exteriorCondition: (p as { exteriorCondition?: string | null } | undefined)?.exteriorCondition ?? '',
      interiorCondition: (p as { interiorCondition?: string | null } | undefined)?.interiorCondition ?? '',
      approvedPlanAuthority: p?.approvedPlanAuthority ?? '',
      approvedPlanDate: p?.approvedPlanDate ? String(p.approvedPlanDate).slice(0, 10) : '',
      approvedPlanNo: p?.approvedPlanNo ?? '',
      approvedPlanValidity: p?.approvedPlanValidity ? String(p.approvedPlanValidity).slice(0, 10) : '',
      planGenuinenessVerified: p?.planGenuinenessVerified ?? false,
      unauthorizedConstruction: p?.unauthorizedConstruction ?? false,
      unauthorizedConstructionNotes: p?.unauthorizedConstructionNotes ?? '',
      demolitionProceedings: p?.demolitionProceedings ?? false,
      demolitionProceedingsNotes: p?.demolitionProceedingsNotes ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        structureType: form.structureType,
        numberOfFloors: form.numberOfFloors ? parseInt(form.numberOfFloors) : null,
        yearOfConstruction: form.yearOfConstruction ? parseInt(form.yearOfConstruction) : null,
        ageOfBuilding: form.ageOfBuilding ? parseInt(form.ageOfBuilding) : null,
        remainingLifeYears: form.remainingLifeYears ? parseInt(form.remainingLifeYears) : null,
        buildingCompletionStatus: (form.buildingCompletionStatus || null) as BuildingCompletionStatus | null,
        roofType: form.roofType,
        exteriorCondition: form.exteriorCondition,
        interiorCondition: form.interiorCondition,
        approvedPlanAuthority: form.approvedPlanAuthority,
        approvedPlanDate: form.approvedPlanDate || null,
        approvedPlanNo: form.approvedPlanNo,
        approvedPlanValidity: form.approvedPlanValidity || null,
        planGenuinenessVerified: form.planGenuinenessVerified,
        unauthorizedConstruction: form.unauthorizedConstruction,
        unauthorizedConstructionNotes: form.unauthorizedConstructionNotes,
        demolitionProceedings: form.demolitionProceedings,
        demolitionProceedingsNotes: form.demolitionProceedingsNotes,
      },
    }, {
      onSuccess: () => toast({ title: 'Building section saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Building Characteristics (BLDG_001–009)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Structure Type (BLDG_001)</Label>
              <Input disabled={!canEdit} value={form.structureType}
                onChange={(e) => setForm((f) => ({ ...f, structureType: e.target.value }))}
                placeholder="RCC / Load Bearing / Steel / Composite" />
            </div>
            <div className="space-y-1">
              <Label>Number of Floors (BLDG_002)</Label>
              <Input disabled={!canEdit} type="number" value={form.numberOfFloors}
                onChange={(e) => setForm((f) => ({ ...f, numberOfFloors: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Year of Construction (BLDG_003)</Label>
              <Input disabled={!canEdit} type="number" value={form.yearOfConstruction}
                onChange={(e) => setForm((f) => ({ ...f, yearOfConstruction: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Age of Building (Yrs) (BLDG_004)</Label>
              <Input disabled={!canEdit} type="number" value={form.ageOfBuilding}
                onChange={(e) => setForm((f) => ({ ...f, ageOfBuilding: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Remaining Life (Yrs) (BLDG_005)</Label>
              <Input disabled={!canEdit} type="number" value={form.remainingLifeYears}
                onChange={(e) => setForm((f) => ({ ...f, remainingLifeYears: e.target.value }))} />
            </div>
            {isUC && (
              <div className="space-y-1">
                <Label>Completion Status (BLDG_006)</Label>
                <Select
                  disabled={!canEdit}
                  value={form.buildingCompletionStatus || '_none'}
                  onValueChange={(v) => setForm((f) => ({ ...f, buildingCompletionStatus: v === '_none' ? '' : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Select —</SelectItem>
                    <SelectItem value={BuildingCompletionStatus.FULLY_COMPLETED}>Fully Completed</SelectItem>
                    <SelectItem value={BuildingCompletionStatus.PARTIALLY_COMPLETED}>Partially Completed</SelectItem>
                    <SelectItem value={BuildingCompletionStatus.UNDER_CONSTRUCTION}>Under Construction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Roof Type (BLDG_007)</Label>
              <Input disabled={!canEdit} value={form.roofType}
                onChange={(e) => setForm((f) => ({ ...f, roofType: e.target.value }))}
                placeholder="RCC Slab / Mangalore / Asbestos" />
            </div>
            <div className="space-y-1">
              <Label>Exterior Condition (BLDG_008)</Label>
              <Input disabled={!canEdit} value={form.exteriorCondition}
                onChange={(e) => setForm((f) => ({ ...f, exteriorCondition: e.target.value }))}
                placeholder="Good / Average / Poor" />
            </div>
            <div className="space-y-1">
              <Label>Interior Condition (BLDG_009)</Label>
              <Input disabled={!canEdit} value={form.interiorCondition}
                onChange={(e) => setForm((f) => ({ ...f, interiorCondition: e.target.value }))}
                placeholder="Good / Average / Poor" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Building Plan Compliance (BLDG_010–016)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Approved Plan Authority (BLDG_010)</Label>
              <Input disabled={!canEdit} value={form.approvedPlanAuthority}
                onChange={(e) => setForm((f) => ({ ...f, approvedPlanAuthority: e.target.value }))}
                placeholder="MCGM / NMMC / CIDCO / Gram Panchayat" />
            </div>
            <div className="space-y-1">
              <Label>Plan No (BLDG_011)</Label>
              <Input disabled={!canEdit} value={form.approvedPlanNo}
                onChange={(e) => setForm((f) => ({ ...f, approvedPlanNo: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Plan Date (BLDG_012)</Label>
              <Input disabled={!canEdit} type="date" value={form.approvedPlanDate}
                onChange={(e) => setForm((f) => ({ ...f, approvedPlanDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Plan Validity Date</Label>
              <Input disabled={!canEdit} type="date" value={form.approvedPlanValidity}
                onChange={(e) => setForm((f) => ({ ...f, approvedPlanValidity: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="planVerified"
                disabled={!canEdit}
                checked={form.planGenuinenessVerified}
                onCheckedChange={(v) => setForm((f) => ({ ...f, planGenuinenessVerified: !!v }))}
              />
              <Label htmlFor="planVerified">Plan genuineness verified (BLDG_013)</Label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="unauthorised"
                  disabled={!canEdit}
                  checked={form.unauthorizedConstruction}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, unauthorizedConstruction: !!v }))}
                />
                <Label htmlFor="unauthorised">Unauthorized construction exists (BLDG_014)</Label>
              </div>
              {form.unauthorizedConstruction && (
                <Textarea
                  disabled={!canEdit}
                  rows={2}
                  value={form.unauthorizedConstructionNotes}
                  onChange={(e) => setForm((f) => ({ ...f, unauthorizedConstructionNotes: e.target.value }))}
                  placeholder="Describe unauthorized construction details"
                />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="demolition"
                  disabled={!canEdit}
                  checked={form.demolitionProceedings}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, demolitionProceedings: !!v }))}
                />
                <Label htmlFor="demolition">Demolition proceedings initiated (BLDG_015)</Label>
              </div>
              {form.demolitionProceedings && (
                <Textarea
                  disabled={!canEdit}
                  rows={2}
                  value={form.demolitionProceedingsNotes}
                  onChange={(e) => setForm((f) => ({ ...f, demolitionProceedingsNotes: e.target.value }))}
                  placeholder="Demolition proceedings details"
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Building'}
          </Button>
        </div>
      )}
    </div>
  );
}
