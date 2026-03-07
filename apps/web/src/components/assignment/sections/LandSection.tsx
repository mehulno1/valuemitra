/**
 * LandSection — LND_001–008
 * Land areas (document values), UDS, FSI, MIDC, land tenure.
 * Data model: Property (saved via PATCH /property-data/:id)
 * Relevant for: Open Land, L&B, Agricultural, Industrial
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Button } from '../../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Save } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useSavePropertyData } from '../../../api/hooks/usePropertyData.js';
import type { PropertyDataResponse } from '../../../api/hooks/usePropertyData.js';
import { LandTenure } from '@valuemitra/shared';

interface Props {
  assignmentId: string;
  propertyType: string;
  propertyData: PropertyDataResponse | undefined;
  canEdit: boolean;
}

export function LandSection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const [form, setForm] = useState({
    // LND_001: Area (sq.m. as primary)
    landAreaSqM: p?.landAreaSqM != null ? String(p.landAreaSqM) : '',
    landAreaSqFt: p?.landAreaSqFt != null ? String(p.landAreaSqFt) : '',
    landAreaAcre: (p as { landAreaAcre?: number | null } | undefined)?.landAreaAcre != null
      ? String((p as { landAreaAcre: number }).landAreaAcre) : '',
    landAreaHectare: (p as { landAreaHectare?: number | null } | undefined)?.landAreaHectare != null
      ? String((p as { landAreaHectare: number }).landAreaHectare) : '',
    // LND_002: Actual measured area
    landAreaActualSqM: p?.landAreaActualSqM != null ? String(p.landAreaActualSqM) : '',
    landAreaActualSqFt: p?.landAreaActualSqFt != null ? String(p.landAreaActualSqFt) : '',
    // LND_003: UDS (for flats)
    udsArea: p?.udsArea != null ? String(p.udsArea) : '',
    udsUnit: p?.udsUnit ?? '',
    // LND_004: Land tenure
    landTenure: (p as { landTenure?: string | null } | undefined)?.landTenure ?? '',
    leaseExpiryDate: (p as { leaseExpiryDate?: string | null } | undefined)?.leaseExpiryDate
      ? String((p as { leaseExpiryDate: string }).leaseExpiryDate).slice(0, 10) : '',
    // LND_005: FSI
    fsi: p?.fsi != null ? String(p.fsi) : '',
    // LND_006: MIDC
    miDcPlotNo: p?.miDcPlotNo ?? '',
    // LND_007: NA order (also in PHY, shared)
    naOrderDetails: p?.naOrderDetails ?? '',
  });

  useEffect(() => {
    setForm({
      landAreaSqM: p?.landAreaSqM != null ? String(p.landAreaSqM) : '',
      landAreaSqFt: p?.landAreaSqFt != null ? String(p.landAreaSqFt) : '',
      landAreaAcre: (p as { landAreaAcre?: number | null } | undefined)?.landAreaAcre != null
        ? String((p as { landAreaAcre: number }).landAreaAcre) : '',
      landAreaHectare: (p as { landAreaHectare?: number | null } | undefined)?.landAreaHectare != null
        ? String((p as { landAreaHectare: number }).landAreaHectare) : '',
      landAreaActualSqM: p?.landAreaActualSqM != null ? String(p.landAreaActualSqM) : '',
      landAreaActualSqFt: p?.landAreaActualSqFt != null ? String(p.landAreaActualSqFt) : '',
      udsArea: p?.udsArea != null ? String(p.udsArea) : '',
      udsUnit: p?.udsUnit ?? '',
      landTenure: (p as { landTenure?: string | null } | undefined)?.landTenure ?? '',
      leaseExpiryDate: (p as { leaseExpiryDate?: string | null } | undefined)?.leaseExpiryDate
        ? String((p as { leaseExpiryDate: string }).leaseExpiryDate).slice(0, 10) : '',
      fsi: p?.fsi != null ? String(p.fsi) : '',
      miDcPlotNo: p?.miDcPlotNo ?? '',
      naOrderDetails: p?.naOrderDetails ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        landAreaSqM: form.landAreaSqM ? parseFloat(form.landAreaSqM) : null,
        landAreaSqFt: form.landAreaSqFt ? parseFloat(form.landAreaSqFt) : null,
        landAreaAcre: form.landAreaAcre ? parseFloat(form.landAreaAcre) : null,
        landAreaHectare: form.landAreaHectare ? parseFloat(form.landAreaHectare) : null,
        landAreaActualSqM: form.landAreaActualSqM ? parseFloat(form.landAreaActualSqM) : null,
        landAreaActualSqFt: form.landAreaActualSqFt ? parseFloat(form.landAreaActualSqFt) : null,
        udsArea: form.udsArea ? parseFloat(form.udsArea) : null,
        udsUnit: form.udsUnit,
        landTenure: (form.landTenure || null) as LandTenure | null,
        leaseExpiryDate: form.leaseExpiryDate || null,
        fsi: form.fsi ? parseFloat(form.fsi) : null,
        miDcPlotNo: form.miDcPlotNo,
        naOrderDetails: form.naOrderDetails,
      },
    }, {
      onSuccess: () => toast({ title: 'Land details saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Land Area — Document Values (LND_001)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Land Area (Sq.M.)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaSqM}
                onChange={(e) => setForm((f) => ({ ...f, landAreaSqM: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Land Area (Sq.Ft.)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaSqFt}
                onChange={(e) => setForm((f) => ({ ...f, landAreaSqFt: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Land Area (Acres)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaAcre}
                onChange={(e) => setForm((f) => ({ ...f, landAreaAcre: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Land Area (Hectares)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaHectare}
                onChange={(e) => setForm((f) => ({ ...f, landAreaHectare: e.target.value }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Actual Site-Measured Area (LND_002)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Actual Land Area (Sq.M.)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaActualSqM}
                onChange={(e) => setForm((f) => ({ ...f, landAreaActualSqM: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Actual Land Area (Sq.Ft.)</Label>
              <Input disabled={!canEdit} type="number" value={form.landAreaActualSqFt}
                onChange={(e) => setForm((f) => ({ ...f, landAreaActualSqFt: e.target.value }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">UDS, Tenure & Planning (LND_003–008)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>UDS Area (LND_003)</Label>
              <Input disabled={!canEdit} type="number" value={form.udsArea}
                onChange={(e) => setForm((f) => ({ ...f, udsArea: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>UDS Unit</Label>
              <Select
                disabled={!canEdit}
                value={form.udsUnit || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, udsUnit: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Sq.Ft">Sq.Ft</SelectItem>
                  <SelectItem value="Sq.M">Sq.M</SelectItem>
                  <SelectItem value="Fraction">Fraction</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Land Tenure (LND_004)</Label>
              <Select
                disabled={!canEdit}
                value={form.landTenure || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, landTenure: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value={LandTenure.FREEHOLD}>Freehold</SelectItem>
                  <SelectItem value={LandTenure.LEASEHOLD}>Leasehold</SelectItem>
                  <SelectItem value={LandTenure.GOVERNMENT_LEASE}>Government Lease</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Lease Expiry Date</Label>
              <Input disabled={!canEdit} type="date" value={form.leaseExpiryDate}
                onChange={(e) => setForm((f) => ({ ...f, leaseExpiryDate: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>FSI (LND_005)</Label>
              <Input disabled={!canEdit} type="number" step="0.01" value={form.fsi}
                onChange={(e) => setForm((f) => ({ ...f, fsi: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>MIDC Plot No (LND_006)</Label>
              <Input disabled={!canEdit} value={form.miDcPlotNo}
                onChange={(e) => setForm((f) => ({ ...f, miDcPlotNo: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>NA Order Details (LND_007)</Label>
            <Input disabled={!canEdit} value={form.naOrderDetails}
              onChange={(e) => setForm((f) => ({ ...f, naOrderDetails: e.target.value }))}
              placeholder="Non-agricultural order no., date, authority" />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Land'}
          </Button>
        </div>
      )}
    </div>
  );
}
