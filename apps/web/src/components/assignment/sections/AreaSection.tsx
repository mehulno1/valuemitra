/**
 * AreaSection — AREA_001–006
 * Area classification: residential/commercial/industrial, urban/rural, local body type, CRZ.
 * Data model: Property.areaClassification JSON + Property.zoningClassification
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
import { Button } from '../../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Save } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useSavePropertyData } from '../../../api/hooks/usePropertyData.js';
import type { PropertyDataResponse } from '../../../api/hooks/usePropertyData.js';

interface Props {
  assignmentId: string;
  propertyType: string;
  propertyData: PropertyDataResponse | undefined;
  canEdit: boolean;
}

export function AreaSection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;
  const ac = p?.areaClassification ?? {};

  const [form, setForm] = useState({
    type: ac.type ?? '',          // AREA_001: Residential / Commercial / Industrial
    highMiddlePoor: ac.highMiddlePoor ?? '', // AREA_002
    urbanRural: ac.urbanRural ?? '',         // AREA_003
    corpType: ac.corpType ?? '',             // AREA_004: Corporation / Municipality / Gram Panchayat
    govtEnactments: ac.govtEnactments ?? '', // AREA_005: CRZ / Heritage Zone / Airport Zone
    czrNote: ac.czrNote ?? '',              // AREA_006
    zoningClassification: p?.zoningClassification ?? '', // also in BLDG but editable here
    dpZone: p?.dpZone ?? '',
    permissibleUse: p?.permissibleUse ?? '',
  });

  useEffect(() => {
    const ac2 = p?.areaClassification ?? {};
    setForm({
      type: ac2.type ?? '',
      highMiddlePoor: ac2.highMiddlePoor ?? '',
      urbanRural: ac2.urbanRural ?? '',
      corpType: ac2.corpType ?? '',
      govtEnactments: ac2.govtEnactments ?? '',
      czrNote: ac2.czrNote ?? '',
      zoningClassification: p?.zoningClassification ?? '',
      dpZone: p?.dpZone ?? '',
      permissibleUse: p?.permissibleUse ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        zoningClassification: form.zoningClassification,
        dpZone: form.dpZone,
        permissibleUse: form.permissibleUse,
        areaClassification: {
          type: form.type,
          highMiddlePoor: form.highMiddlePoor,
          urbanRural: form.urbanRural,
          corpType: form.corpType,
          govtEnactments: form.govtEnactments,
          czrNote: form.czrNote,
        },
      },
    }, {
      onSuccess: () => toast({ title: 'Area classification saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Area Classification (AREA_001–004)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Property Use Type (AREA_001)</Label>
              <Select
                disabled={!canEdit}
                value={form.type || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Residential">Residential</SelectItem>
                  <SelectItem value="Commercial">Commercial</SelectItem>
                  <SelectItem value="Industrial">Industrial</SelectItem>
                  <SelectItem value="Mixed Use">Mixed Use</SelectItem>
                  <SelectItem value="Agricultural">Agricultural</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Locality Class (AREA_002)</Label>
              <Select
                disabled={!canEdit}
                value={form.highMiddlePoor || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, highMiddlePoor: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Middle">Middle</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Urban / Rural (AREA_003)</Label>
              <Select
                disabled={!canEdit}
                value={form.urbanRural || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, urbanRural: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Urban">Urban</SelectItem>
                  <SelectItem value="Semi-Urban">Semi-Urban</SelectItem>
                  <SelectItem value="Rural">Rural</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Local Body Type (AREA_004)</Label>
              <Input
                disabled={!canEdit}
                value={form.corpType}
                onChange={(e) => setForm((f) => ({ ...f, corpType: e.target.value }))}
                placeholder="Corporation / Municipality / Gram Panchayat / CIDCO"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Govt Enactments & Zoning (AREA_005–006)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Govt Enactments / Restrictions (AREA_005)</Label>
            <Textarea
              disabled={!canEdit}
              rows={2}
              value={form.govtEnactments}
              onChange={(e) => setForm((f) => ({ ...f, govtEnactments: e.target.value }))}
              placeholder="CRZ / Heritage Zone / Airport Zone / Eco-sensitive Zone restrictions"
            />
          </div>

          <div className="space-y-1">
            <Label>CRZ / Other Note (AREA_006)</Label>
            <Input
              disabled={!canEdit}
              value={form.czrNote}
              onChange={(e) => setForm((f) => ({ ...f, czrNote: e.target.value }))}
              placeholder="CRZ classification or other note"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Zoning Classification</Label>
              <Input
                disabled={!canEdit}
                value={form.zoningClassification}
                onChange={(e) => setForm((f) => ({ ...f, zoningClassification: e.target.value }))}
                placeholder="Residential / Commercial / Industrial"
              />
            </div>
            <div className="space-y-1">
              <Label>DP Zone</Label>
              <Input
                disabled={!canEdit}
                value={form.dpZone}
                onChange={(e) => setForm((f) => ({ ...f, dpZone: e.target.value }))}
                placeholder="Development Plan zone"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Permissible Use</Label>
            <Input
              disabled={!canEdit}
              value={form.permissibleUse}
              onChange={(e) => setForm((f) => ({ ...f, permissibleUse: e.target.value }))}
              placeholder="Permitted use under DP"
            />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Area'}
          </Button>
        </div>
      )}
    </div>
  );
}
