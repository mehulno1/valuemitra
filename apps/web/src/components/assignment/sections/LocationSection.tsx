/**
 * LocationSection — LOC_001–017
 * Property identification: plot/flat/survey numbers, address, GPS coordinates.
 * Data model: Property (saved via PATCH /property-data/:id)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
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

// LOC fields on Property model
type LocForm = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  taluka: string;
  village: string;
  state: string;
  pincode: string;
  landmark: string;
  municipalCorporation: string;
  streetName: string;
  // Identification
  surveyNo: string;
  hissaNo: string;
  ctsSurveyNo: string;
  municipalNo: string;
  societyName: string;
  buildingName: string;
  wingName: string;
  flatNo: string;
  floor: string;
  // GPS
  latitude: string;
  longitude: string;
};

const SHOW_FLAT_TYPES = ['RESIDENTIAL_FLAT', 'COMMERCIAL_SHOP', 'COMMERCIAL_OFFICE', 'COMMERCIAL_SHOWROOM', 'UC_FLAT'];
const SHOW_SURVEY_TYPES = ['OPEN_LAND', 'LAND_AND_BUILDING', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'];

export function LocationSection({ assignmentId, propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const [form, setForm] = useState<LocForm>({
    addressLine1: (p as { addressLine1?: string | null } | undefined)?.addressLine1 ?? '',
    addressLine2: (p as { addressLine2?: string | null } | undefined)?.addressLine2 ?? '',
    city: p?.city ?? '',
    district: (p as { district?: string | null } | undefined)?.district ?? '',
    taluka: p?.taluka ?? '',
    village: p?.village ?? '',
    state: p?.state ?? '',
    pincode: p?.pincode ?? '',
    landmark: p?.landmark ?? '',
    municipalCorporation: p?.municipalCorporation ?? '',
    streetName: (p as { streetName?: string | null } | undefined)?.streetName ?? '',
    surveyNo: p?.surveyNo ?? '',
    hissaNo: p?.hissaNo ?? '',
    ctsSurveyNo: p?.ctsSurveyNo ?? '',
    municipalNo: p?.municipalNo ?? '',
    societyName: p?.societyName ?? '',
    buildingName: p?.buildingName ?? '',
    wingName: p?.wingName ?? '',
    flatNo: p?.flatNo ?? '',
    floor: p?.floor != null ? String(p.floor) : '',
    latitude: (p as { latitude?: number | null } | undefined)?.latitude != null ? String((p as { latitude: number }).latitude) : '',
    longitude: (p as { longitude?: number | null } | undefined)?.longitude != null ? String((p as { longitude: number }).longitude) : '',
  });

  useEffect(() => {
    setForm({
      addressLine1: (p as { addressLine1?: string | null } | undefined)?.addressLine1 ?? '',
      addressLine2: (p as { addressLine2?: string | null } | undefined)?.addressLine2 ?? '',
      city: p?.city ?? '',
      district: (p as { district?: string | null } | undefined)?.district ?? '',
      taluka: p?.taluka ?? '',
      village: p?.village ?? '',
      state: p?.state ?? '',
      pincode: p?.pincode ?? '',
      landmark: p?.landmark ?? '',
      municipalCorporation: p?.municipalCorporation ?? '',
      streetName: (p as { streetName?: string | null } | undefined)?.streetName ?? '',
      surveyNo: p?.surveyNo ?? '',
      hissaNo: p?.hissaNo ?? '',
      ctsSurveyNo: p?.ctsSurveyNo ?? '',
      municipalNo: p?.municipalNo ?? '',
      societyName: p?.societyName ?? '',
      buildingName: p?.buildingName ?? '',
      wingName: p?.wingName ?? '',
      flatNo: p?.flatNo ?? '',
      floor: p?.floor != null ? String(p.floor) : '',
      latitude: (p as { latitude?: number | null } | undefined)?.latitude != null ? String((p as { latitude: number }).latitude) : '',
      longitude: (p as { longitude?: number | null } | undefined)?.longitude != null ? String((p as { longitude: number }).longitude) : '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key: keyof LocForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function handleSave() {
    save({
      assignmentId,
      data: {
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        district: form.district,
        taluka: form.taluka,
        village: form.village,
        landmark: form.landmark,
        municipalCorporation: form.municipalCorporation,
        streetName: form.streetName,
        surveyNo: form.surveyNo,
        hissaNo: form.hissaNo,
        ctsSurveyNo: form.ctsSurveyNo,
        municipalNo: form.municipalNo,
        societyName: form.societyName,
        buildingName: form.buildingName,
        wingName: form.wingName,
        flatNo: form.flatNo,
        floor: form.floor ? parseInt(form.floor) : null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      },
    }, {
      onSuccess: () => toast({ title: 'Location section saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  const showFlatFields = SHOW_FLAT_TYPES.includes(propertyType);
  const showSurveyFields = SHOW_SURVEY_TYPES.includes(propertyType) || !showFlatFields;

  return (
    <div className="space-y-4">
      {/* Property address */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Full Address (LOC_001–007)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Address Line 1 *</Label>
            <Textarea
              disabled={!canEdit}
              rows={2}
              value={form.addressLine1}
              onChange={set('addressLine1')}
              placeholder="Plot/Flat/House number, Street name, Area"
            />
          </div>
          <div className="space-y-1">
            <Label>Address Line 2</Label>
            <Input disabled={!canEdit} value={form.addressLine2} onChange={set('addressLine2')} placeholder="Locality / Sector" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>City / Taluka *</Label>
              <Input disabled={!canEdit} value={form.city} onChange={set('city')} />
            </div>
            <div className="space-y-1">
              <Label>District (LOC_003)</Label>
              <Input disabled={!canEdit} value={form.district} onChange={set('district')} />
            </div>
            <div className="space-y-1">
              <Label>State *</Label>
              <Input disabled={!canEdit} value={form.state} onChange={set('state')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>PIN Code</Label>
              <Input disabled={!canEdit} value={form.pincode} onChange={set('pincode')} maxLength={6} />
            </div>
            <div className="space-y-1">
              <Label>Street Name (LOC_008)</Label>
              <Input disabled={!canEdit} value={form.streetName} onChange={set('streetName')} />
            </div>
            <div className="space-y-1">
              <Label>Landmark</Label>
              <Input disabled={!canEdit} value={form.landmark} onChange={set('landmark')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Village / Mouje</Label>
              <Input disabled={!canEdit} value={form.village} onChange={set('village')} />
            </div>
            <div className="space-y-1">
              <Label>Taluka</Label>
              <Input disabled={!canEdit} value={form.taluka} onChange={set('taluka')} />
            </div>
            <div className="space-y-1">
              <Label>Municipal Corporation / Local Body</Label>
              <Input disabled={!canEdit} value={form.municipalCorporation} onChange={set('municipalCorporation')}
                placeholder="MCGM / NMMC / Gram Panchayat" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Property identification */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Property Identification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {showSurveyFields && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Survey No</Label>
                <Input disabled={!canEdit} value={form.surveyNo} onChange={set('surveyNo')} />
              </div>
              <div className="space-y-1">
                <Label>Hissa No</Label>
                <Input disabled={!canEdit} value={form.hissaNo} onChange={set('hissaNo')} />
              </div>
              <div className="space-y-1">
                <Label>CTS Survey No</Label>
                <Input disabled={!canEdit} value={form.ctsSurveyNo} onChange={set('ctsSurveyNo')} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Municipal / Plot No</Label>
              <Input disabled={!canEdit} value={form.municipalNo} onChange={set('municipalNo')} />
            </div>
            <div className="space-y-1">
              <Label>Society / Complex Name</Label>
              <Input disabled={!canEdit} value={form.societyName} onChange={set('societyName')} />
            </div>
            <div className="space-y-1">
              <Label>Building Name</Label>
              <Input disabled={!canEdit} value={form.buildingName} onChange={set('buildingName')} />
            </div>
          </div>
          {showFlatFields && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Wing / Block / Tower</Label>
                <Input disabled={!canEdit} value={form.wingName} onChange={set('wingName')} />
              </div>
              <div className="space-y-1">
                <Label>Flat / Unit No</Label>
                <Input disabled={!canEdit} value={form.flatNo} onChange={set('flatNo')} />
              </div>
              <div className="space-y-1">
                <Label>Floor No (0 = Ground)</Label>
                <Input disabled={!canEdit} type="number" value={form.floor} onChange={set('floor')} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GPS coordinates */}
      <Card>
        <CardHeader><CardTitle className="text-sm">GPS Coordinates (LOC_015–016)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Latitude</Label>
              <Input disabled={!canEdit} type="number" step="0.000001" value={form.latitude} onChange={set('latitude')} placeholder="18.9220" />
            </div>
            <div className="space-y-1">
              <Label>Longitude</Label>
              <Input disabled={!canEdit} type="number" step="0.000001" value={form.longitude} onChange={set('longitude')} placeholder="72.8347" />
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Location'}
          </Button>
        </div>
      )}
    </div>
  );
}
