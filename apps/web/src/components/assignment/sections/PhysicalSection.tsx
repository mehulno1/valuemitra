/**
 * PhysicalSection — PHY_001–012
 * Land physical characteristics: nature, layout, shape, road, access, boundary, possession, tenancy.
 * Data model: Property.physicalDetails JSON
 * Relevant types: Open Land, Agricultural, L&B, Industrial (N for Flat/Shop/Office/Unit)
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

export function PhysicalSection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;
  const pd = p?.physicalDetails ?? {};

  const [form, setForm] = useState({
    landNature: pd.landNature ?? '',      // PHY_001
    landLayout: pd.landLayout ?? '',      // PHY_002
    plotShape: pd.plotShape ?? '',        // PHY_003
    directAccess: pd.directAccess ?? '',  // PHY_004: Yes/No
    accessMode: pd.accessMode ?? '',      // PHY_005
    boundaryNature: pd.boundaryNature ?? '', // PHY_006
    demarcated: pd.demarcated ?? '',      // PHY_007: Yes/No
    possession: pd.possession ?? '',      // PHY_008
    tenancyNature: pd.tenancyNature ?? '', // PHY_009
    crops: pd.crops ?? '',               // PHY_010
    otherDev: pd.otherDev ?? '',         // PHY_011
    naOrderDetails: p?.naOrderDetails ?? '', // PHY_012 / LND
  });

  useEffect(() => {
    const pd2 = p?.physicalDetails ?? {};
    setForm({
      landNature: pd2.landNature ?? '',
      landLayout: pd2.landLayout ?? '',
      plotShape: pd2.plotShape ?? '',
      directAccess: pd2.directAccess ?? '',
      accessMode: pd2.accessMode ?? '',
      boundaryNature: pd2.boundaryNature ?? '',
      demarcated: pd2.demarcated ?? '',
      possession: pd2.possession ?? '',
      tenancyNature: pd2.tenancyNature ?? '',
      crops: pd2.crops ?? '',
      otherDev: pd2.otherDev ?? '',
      naOrderDetails: p?.naOrderDetails ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        naOrderDetails: form.naOrderDetails,
        physicalDetails: {
          landNature: form.landNature,
          landLayout: form.landLayout,
          plotShape: form.plotShape,
          directAccess: form.directAccess,
          accessMode: form.accessMode,
          boundaryNature: form.boundaryNature,
          demarcated: form.demarcated,
          possession: form.possession,
          tenancyNature: form.tenancyNature,
          crops: form.crops,
          otherDev: form.otherDev,
        },
      },
    }, {
      onSuccess: () => toast({ title: 'Physical details saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Land Physical Characteristics (PHY_001–007)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Land Nature (PHY_001)</Label>
              <Input disabled={!canEdit} value={form.landNature} onChange={(e) => setForm((f) => ({ ...f, landNature: e.target.value }))}
                placeholder="Dry / Wet / Irrigated / Saline" />
            </div>
            <div className="space-y-1">
              <Label>Land Layout (PHY_002)</Label>
              <Input disabled={!canEdit} value={form.landLayout} onChange={(e) => setForm((f) => ({ ...f, landLayout: e.target.value }))}
                placeholder="Flat / Sloping / Undulating / Low-lying" />
            </div>
            <div className="space-y-1">
              <Label>Plot Shape (PHY_003)</Label>
              <Input disabled={!canEdit} value={form.plotShape} onChange={(e) => setForm((f) => ({ ...f, plotShape: e.target.value }))}
                placeholder="Regular / Irregular / L-shaped / Triangular" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Direct Road Access (PHY_004)</Label>
              <Select
                disabled={!canEdit}
                value={form.directAccess || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, directAccess: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Access Mode (PHY_005)</Label>
              <Input disabled={!canEdit} value={form.accessMode} onChange={(e) => setForm((f) => ({ ...f, accessMode: e.target.value }))}
                placeholder="Approach road / Nala / Easement right" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Boundary Wall Nature (PHY_006)</Label>
              <Input disabled={!canEdit} value={form.boundaryNature} onChange={(e) => setForm((f) => ({ ...f, boundaryNature: e.target.value }))}
                placeholder="RCC / Barbed wire / Compound wall / Open" />
            </div>
            <div className="space-y-1">
              <Label>Demarcated (PHY_007)</Label>
              <Select
                disabled={!canEdit}
                value={form.demarcated || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, demarcated: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Possession & Use (PHY_008–012)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Possession Status (PHY_008)</Label>
            <Input disabled={!canEdit} value={form.possession} onChange={(e) => setForm((f) => ({ ...f, possession: e.target.value }))}
              placeholder="Owner in possession / Tenant in possession / Vacant" />
          </div>

          <div className="space-y-1">
            <Label>Tenancy Nature (PHY_009)</Label>
            <Textarea disabled={!canEdit} rows={2} value={form.tenancyNature}
              onChange={(e) => setForm((f) => ({ ...f, tenancyNature: e.target.value }))}
              placeholder="Tenancy details if applicable" />
          </div>

          <div className="space-y-1">
            <Label>Crops / Cultivation (PHY_010)</Label>
            <Input disabled={!canEdit} value={form.crops} onChange={(e) => setForm((f) => ({ ...f, crops: e.target.value }))}
              placeholder="Type of crops / cultivation details" />
          </div>

          <div className="space-y-1">
            <Label>Other Developments / Structures (PHY_011)</Label>
            <Textarea disabled={!canEdit} rows={2} value={form.otherDev}
              onChange={(e) => setForm((f) => ({ ...f, otherDev: e.target.value }))}
              placeholder="Structures, sheds, pump houses, wells, etc." />
          </div>

          <div className="space-y-1">
            <Label>NA Order Details (PHY_012)</Label>
            <Input disabled={!canEdit} value={form.naOrderDetails}
              onChange={(e) => setForm((f) => ({ ...f, naOrderDetails: e.target.value }))}
              placeholder="Non-agricultural conversion order no., date, authority" />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Physical'}
          </Button>
        </div>
      )}
    </div>
  );
}
