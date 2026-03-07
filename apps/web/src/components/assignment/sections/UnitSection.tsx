/**
 * UnitSection — UNIT_001–014
 * Unit/flat-level details: carpet/built-up areas, configuration, legal documents.
 * Data model: Property (saved via PATCH /property-data/:id)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Button } from '../../ui/button.js';
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

export function UnitSection({ assignmentId, propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const showSuperBuiltUp = ['RESIDENTIAL_FLAT', 'COMMERCIAL_OFFICE', 'COMMERCIAL_SHOP', 'UC_FLAT'].includes(propertyType);
  const showCarpet = !['OPEN_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'].includes(propertyType);

  const [form, setForm] = useState({
    // UNIT_001–003: Areas (document values)
    builtUpAreaSqM: p?.builtUpAreaSqM != null ? String(p.builtUpAreaSqM) : '',
    builtUpAreaSqFt: p?.builtUpAreaSqFt != null ? String(p.builtUpAreaSqFt) : '',
    carpetAreaSqM: p?.carpetAreaSqM != null ? String(p.carpetAreaSqM) : '',
    carpetAreaSqFt: p?.carpetAreaSqFt != null ? String(p.carpetAreaSqFt) : '',
    superBuiltUpAreaSqM: p?.superBuiltUpAreaSqM != null ? String(p.superBuiltUpAreaSqM) : '',
    superBuiltUpAreaSqFt: p?.superBuiltUpAreaSqFt != null ? String(p.superBuiltUpAreaSqFt) : '',
    // UNIT_004: Actual areas
    builtUpAreaActualSqM: p?.builtUpAreaActualSqM != null ? String(p.builtUpAreaActualSqM) : '',
    builtUpAreaActualSqFt: p?.builtUpAreaActualSqFt != null ? String(p.builtUpAreaActualSqFt) : '',
    carpetAreaActualSqM: p?.carpetAreaActualSqM != null ? String(p.carpetAreaActualSqM) : '',
    carpetAreaActualSqFt: p?.carpetAreaActualSqFt != null ? String(p.carpetAreaActualSqFt) : '',
    // UNIT_005: Configuration
    unitConfiguration: p?.unitConfiguration ?? '',       // 2BHK / 3BHK / Open Plan
    // Legal document refs
    registrationNo: p?.registrationNo ?? '',
    registrationDate: p?.registrationDate ? String(p.registrationDate).slice(0, 10) : '',
    indexIINo: p?.indexIINo ?? '',
    agreementValue: p?.agreementValue != null ? String(p.agreementValue) : '',
    stampDutyPaid: p?.stampDutyPaid != null ? String(p.stampDutyPaid) : '',
    occupancyCertificateNo: p?.occupancyCertificateNo ?? '',
    sharesCertificateNo: p?.sharesCertificateNo ?? '',
  });

  useEffect(() => {
    setForm({
      builtUpAreaSqM: p?.builtUpAreaSqM != null ? String(p.builtUpAreaSqM) : '',
      builtUpAreaSqFt: p?.builtUpAreaSqFt != null ? String(p.builtUpAreaSqFt) : '',
      carpetAreaSqM: p?.carpetAreaSqM != null ? String(p.carpetAreaSqM) : '',
      carpetAreaSqFt: p?.carpetAreaSqFt != null ? String(p.carpetAreaSqFt) : '',
      superBuiltUpAreaSqM: p?.superBuiltUpAreaSqM != null ? String(p.superBuiltUpAreaSqM) : '',
      superBuiltUpAreaSqFt: p?.superBuiltUpAreaSqFt != null ? String(p.superBuiltUpAreaSqFt) : '',
      builtUpAreaActualSqM: p?.builtUpAreaActualSqM != null ? String(p.builtUpAreaActualSqM) : '',
      builtUpAreaActualSqFt: p?.builtUpAreaActualSqFt != null ? String(p.builtUpAreaActualSqFt) : '',
      carpetAreaActualSqM: p?.carpetAreaActualSqM != null ? String(p.carpetAreaActualSqM) : '',
      carpetAreaActualSqFt: p?.carpetAreaActualSqFt != null ? String(p.carpetAreaActualSqFt) : '',
      unitConfiguration: p?.unitConfiguration ?? '',
      registrationNo: p?.registrationNo ?? '',
      registrationDate: p?.registrationDate ? String(p.registrationDate).slice(0, 10) : '',
      indexIINo: p?.indexIINo ?? '',
      agreementValue: p?.agreementValue != null ? String(p.agreementValue) : '',
      stampDutyPaid: p?.stampDutyPaid != null ? String(p.stampDutyPaid) : '',
      occupancyCertificateNo: p?.occupancyCertificateNo ?? '',
      sharesCertificateNo: p?.sharesCertificateNo ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        builtUpAreaSqM: form.builtUpAreaSqM ? parseFloat(form.builtUpAreaSqM) : null,
        builtUpAreaSqFt: form.builtUpAreaSqFt ? parseFloat(form.builtUpAreaSqFt) : null,
        carpetAreaSqM: form.carpetAreaSqM ? parseFloat(form.carpetAreaSqM) : null,
        carpetAreaSqFt: form.carpetAreaSqFt ? parseFloat(form.carpetAreaSqFt) : null,
        superBuiltUpAreaSqM: form.superBuiltUpAreaSqM ? parseFloat(form.superBuiltUpAreaSqM) : null,
        superBuiltUpAreaSqFt: form.superBuiltUpAreaSqFt ? parseFloat(form.superBuiltUpAreaSqFt) : null,
        builtUpAreaActualSqM: form.builtUpAreaActualSqM ? parseFloat(form.builtUpAreaActualSqM) : null,
        builtUpAreaActualSqFt: form.builtUpAreaActualSqFt ? parseFloat(form.builtUpAreaActualSqFt) : null,
        carpetAreaActualSqM: form.carpetAreaActualSqM ? parseFloat(form.carpetAreaActualSqM) : null,
        carpetAreaActualSqFt: form.carpetAreaActualSqFt ? parseFloat(form.carpetAreaActualSqFt) : null,
        unitConfiguration: form.unitConfiguration,
        registrationNo: form.registrationNo,
        registrationDate: form.registrationDate || null,
        indexIINo: form.indexIINo,
        agreementValue: form.agreementValue ? parseFloat(form.agreementValue) : null,
        stampDutyPaid: form.stampDutyPaid ? parseFloat(form.stampDutyPaid) : null,
        occupancyCertificateNo: form.occupancyCertificateNo,
        sharesCertificateNo: form.sharesCertificateNo,
      },
    }, {
      onSuccess: () => toast({ title: 'Unit section saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Unit Configuration (UNIT_005)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            <Label>Configuration</Label>
            <Input disabled={!canEdit} value={form.unitConfiguration}
              onChange={(e) => setForm((f) => ({ ...f, unitConfiguration: e.target.value }))}
              placeholder="e.g. 2BHK+2T, 3BHK, Open Plan Office, Showroom" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Built-Up Area — Document Values (UNIT_001)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Built-Up Area (Sq.M.)</Label>
              <Input disabled={!canEdit} type="number" value={form.builtUpAreaSqM}
                onChange={(e) => setForm((f) => ({ ...f, builtUpAreaSqM: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Built-Up Area (Sq.Ft.)</Label>
              <Input disabled={!canEdit} type="number" value={form.builtUpAreaSqFt}
                onChange={(e) => setForm((f) => ({ ...f, builtUpAreaSqFt: e.target.value }))} />
            </div>
          </div>
          {showCarpet && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Carpet Area (Sq.M.) (UNIT_002)</Label>
                <Input disabled={!canEdit} type="number" value={form.carpetAreaSqM}
                  onChange={(e) => setForm((f) => ({ ...f, carpetAreaSqM: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Carpet Area (Sq.Ft.)</Label>
                <Input disabled={!canEdit} type="number" value={form.carpetAreaSqFt}
                  onChange={(e) => setForm((f) => ({ ...f, carpetAreaSqFt: e.target.value }))} />
              </div>
            </div>
          )}
          {showSuperBuiltUp && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Super Built-Up Area (Sq.M.) (UNIT_003)</Label>
                <Input disabled={!canEdit} type="number" value={form.superBuiltUpAreaSqM}
                  onChange={(e) => setForm((f) => ({ ...f, superBuiltUpAreaSqM: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Super Built-Up Area (Sq.Ft.)</Label>
                <Input disabled={!canEdit} type="number" value={form.superBuiltUpAreaSqFt}
                  onChange={(e) => setForm((f) => ({ ...f, superBuiltUpAreaSqFt: e.target.value }))} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Actual Site-Measured Areas (UNIT_004)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Auto-populated from Site Visit section when inspector saves measurements</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Actual Built-Up Area (Sq.M.)</Label>
              <Input disabled={!canEdit} type="number" value={form.builtUpAreaActualSqM}
                onChange={(e) => setForm((f) => ({ ...f, builtUpAreaActualSqM: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Actual Built-Up Area (Sq.Ft.)</Label>
              <Input disabled={!canEdit} type="number" value={form.builtUpAreaActualSqFt}
                onChange={(e) => setForm((f) => ({ ...f, builtUpAreaActualSqFt: e.target.value }))} />
            </div>
          </div>
          {showCarpet && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Actual Carpet Area (Sq.M.)</Label>
                <Input disabled={!canEdit} type="number" value={form.carpetAreaActualSqM}
                  onChange={(e) => setForm((f) => ({ ...f, carpetAreaActualSqM: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Actual Carpet Area (Sq.Ft.)</Label>
                <Input disabled={!canEdit} type="number" value={form.carpetAreaActualSqFt}
                  onChange={(e) => setForm((f) => ({ ...f, carpetAreaActualSqFt: e.target.value }))} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Legal Document References (UNIT_006–014)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Registration No</Label>
              <Input disabled={!canEdit} value={form.registrationNo}
                onChange={(e) => setForm((f) => ({ ...f, registrationNo: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Registration Date</Label>
              <Input disabled={!canEdit} type="date" value={form.registrationDate}
                onChange={(e) => setForm((f) => ({ ...f, registrationDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Index II No</Label>
              <Input disabled={!canEdit} value={form.indexIINo}
                onChange={(e) => setForm((f) => ({ ...f, indexIINo: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Agreement Value (₹)</Label>
              <Input disabled={!canEdit} type="number" value={form.agreementValue}
                onChange={(e) => setForm((f) => ({ ...f, agreementValue: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Stamp Duty Paid (₹)</Label>
              <Input disabled={!canEdit} type="number" value={form.stampDutyPaid}
                onChange={(e) => setForm((f) => ({ ...f, stampDutyPaid: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>OC No</Label>
              <Input disabled={!canEdit} value={form.occupancyCertificateNo}
                onChange={(e) => setForm((f) => ({ ...f, occupancyCertificateNo: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Shares Certificate No (Society)</Label>
            <Input disabled={!canEdit} value={form.sharesCertificateNo}
              onChange={(e) => setForm((f) => ({ ...f, sharesCertificateNo: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Unit'}
          </Button>
        </div>
      )}
    </div>
  );
}
