/**
 * BoundarySection — BND_001–008
 * N/S/E/W boundaries (document values vs actual site measurements).
 * Data model: Property.boundaryDetails JSON
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

export function BoundarySection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;
  const bd = p?.boundaryDetails ?? {};

  const [form, setForm] = useState({
    northDoc: bd.northDoc ?? '',      // BND_001: North boundary per document
    southDoc: bd.southDoc ?? '',      // BND_002
    eastDoc: bd.eastDoc ?? '',        // BND_003
    westDoc: bd.westDoc ?? '',        // BND_004
    northActual: bd.northActual ?? '', // BND_005: North boundary per site visit
    southActual: bd.southActual ?? '', // BND_006
    eastActual: bd.eastActual ?? '',   // BND_007
    westActual: bd.westActual ?? '',   // BND_008
  });

  useEffect(() => {
    const bd2 = p?.boundaryDetails ?? {};
    setForm({
      northDoc: bd2.northDoc ?? '',
      southDoc: bd2.southDoc ?? '',
      eastDoc: bd2.eastDoc ?? '',
      westDoc: bd2.westDoc ?? '',
      northActual: bd2.northActual ?? '',
      southActual: bd2.southActual ?? '',
      eastActual: bd2.eastActual ?? '',
      westActual: bd2.westActual ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    save({
      assignmentId,
      data: {
        boundaryDetails: {
          northDoc: form.northDoc,
          southDoc: form.southDoc,
          eastDoc: form.eastDoc,
          westDoc: form.westDoc,
          northActual: form.northActual,
          southActual: form.southActual,
          eastActual: form.eastActual,
          westActual: form.westActual,
        },
      },
    }, {
      onSuccess: () => toast({ title: 'Boundaries saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Document Boundaries (BND_001–004)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">As mentioned in the title document / sale deed</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>North (BND_001)</Label>
              <Input disabled={!canEdit} value={form.northDoc}
                onChange={(e) => setForm((f) => ({ ...f, northDoc: e.target.value }))}
                placeholder="Northern boundary per document" />
            </div>
            <div className="space-y-1">
              <Label>South (BND_002)</Label>
              <Input disabled={!canEdit} value={form.southDoc}
                onChange={(e) => setForm((f) => ({ ...f, southDoc: e.target.value }))}
                placeholder="Southern boundary per document" />
            </div>
            <div className="space-y-1">
              <Label>East (BND_003)</Label>
              <Input disabled={!canEdit} value={form.eastDoc}
                onChange={(e) => setForm((f) => ({ ...f, eastDoc: e.target.value }))}
                placeholder="Eastern boundary per document" />
            </div>
            <div className="space-y-1">
              <Label>West (BND_004)</Label>
              <Input disabled={!canEdit} value={form.westDoc}
                onChange={(e) => setForm((f) => ({ ...f, westDoc: e.target.value }))}
                placeholder="Western boundary per document" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Actual Site Boundaries (BND_005–008)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">As observed during site inspection</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>North (BND_005)</Label>
              <Input disabled={!canEdit} value={form.northActual}
                onChange={(e) => setForm((f) => ({ ...f, northActual: e.target.value }))}
                placeholder="Northern boundary as observed" />
            </div>
            <div className="space-y-1">
              <Label>South (BND_006)</Label>
              <Input disabled={!canEdit} value={form.southActual}
                onChange={(e) => setForm((f) => ({ ...f, southActual: e.target.value }))}
                placeholder="Southern boundary as observed" />
            </div>
            <div className="space-y-1">
              <Label>East (BND_007)</Label>
              <Input disabled={!canEdit} value={form.eastActual}
                onChange={(e) => setForm((f) => ({ ...f, eastActual: e.target.value }))}
                placeholder="Eastern boundary as observed" />
            </div>
            <div className="space-y-1">
              <Label>West (BND_008)</Label>
              <Input disabled={!canEdit} value={form.westActual}
                onChange={(e) => setForm((f) => ({ ...f, westActual: e.target.value }))}
                placeholder="Western boundary as observed" />
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Boundaries'}
          </Button>
        </div>
      )}
    </div>
  );
}
