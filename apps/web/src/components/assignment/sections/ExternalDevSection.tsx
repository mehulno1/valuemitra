/**
 * ExternalDevSection — BLDA_001–006
 * Floor-wise built-up breakdown + external development areas + industrial structures.
 * Data model: Property (saved via PATCH /property-data/:id)
 * Relevant for: L&B, Industrial
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Textarea } from '../../ui/textarea.js';
import { Button } from '../../ui/button.js';
import { Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useSavePropertyData } from '../../../api/hooks/usePropertyData.js';
import type { PropertyDataResponse } from '../../../api/hooks/usePropertyData.js';

interface FloorRow {
  floorLabel: string;
  useType: string;
  builtUpAreaSqM?: number;
  builtUpAreaSqFt?: number;
  remarks?: string;
}

interface Props {
  assignmentId: string;
  propertyType: string;
  propertyData: PropertyDataResponse | undefined;
  canEdit: boolean;
}

export function ExternalDevSection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const [floors, setFloors] = useState<FloorRow[]>(p?.buildingFloors ?? []);
  const [externalDevAreaSqM, setExternalDevAreaSqM] = useState(
    (p as { externalDevAreaSqM?: number | null } | undefined)?.externalDevAreaSqM != null
      ? String((p as { externalDevAreaSqM: number }).externalDevAreaSqM) : ''
  );
  const [externalDevAreaSqFt, setExternalDevAreaSqFt] = useState(
    (p as { externalDevAreaSqFt?: number | null } | undefined)?.externalDevAreaSqFt != null
      ? String((p as { externalDevAreaSqFt: number }).externalDevAreaSqFt) : ''
  );
  const [industrialStructures, setIndustrialStructures] = useState(
    (p as { industrialStructures?: string | null } | undefined)?.industrialStructures ?? ''
  );

  useEffect(() => {
    setFloors(p?.buildingFloors ?? []);
    setExternalDevAreaSqM(
      (p as { externalDevAreaSqM?: number | null } | undefined)?.externalDevAreaSqM != null
        ? String((p as { externalDevAreaSqM: number }).externalDevAreaSqM) : ''
    );
    setExternalDevAreaSqFt(
      (p as { externalDevAreaSqFt?: number | null } | undefined)?.externalDevAreaSqFt != null
        ? String((p as { externalDevAreaSqFt: number }).externalDevAreaSqFt) : ''
    );
    setIndustrialStructures((p as { industrialStructures?: string | null } | undefined)?.industrialStructures ?? '');
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function addFloor() {
    setFloors((prev) => [...prev, { floorLabel: '', useType: '' }]);
  }

  function removeFloor(i: number) {
    setFloors((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateFloor(i: number, key: keyof FloorRow, value: string) {
    setFloors((prev) => prev.map((row, idx) => {
      if (idx !== i) return row;
      if (key === 'builtUpAreaSqM' || key === 'builtUpAreaSqFt') {
        return { ...row, [key]: value ? parseFloat(value) : undefined };
      }
      return { ...row, [key]: value };
    }));
  }

  function handleSave() {
    save({
      assignmentId,
      data: {
        buildingFloors: floors.filter((f) => f.floorLabel || f.useType),
        externalDevAreaSqM: externalDevAreaSqM ? parseFloat(externalDevAreaSqM) : null,
        externalDevAreaSqFt: externalDevAreaSqFt ? parseFloat(externalDevAreaSqFt) : null,
        industrialStructures: industrialStructures,
      },
    }, {
      onSuccess: () => toast({ title: 'External development saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Floor-wise Built-Up Areas (BLDA_001–004)</CardTitle>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={addFloor}>
                <Plus className="h-4 w-4 mr-1" /> Add Floor
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {floors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No floor data added. Click Add Floor to begin.</p>
          ) : (
            <div className="space-y-3">
              {floors.map((row, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 items-end border rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Floor Label</Label>
                    <Input
                      disabled={!canEdit}
                      value={row.floorLabel}
                      onChange={(e) => updateFloor(i, 'floorLabel', e.target.value)}
                      placeholder="Ground / 1st / 2nd"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Use Type</Label>
                    <Input
                      disabled={!canEdit}
                      value={row.useType}
                      onChange={(e) => updateFloor(i, 'useType', e.target.value)}
                      placeholder="Shop / Office / Residence"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Built-Up Area (Sq.M.)</Label>
                    <Input
                      disabled={!canEdit}
                      type="number"
                      value={row.builtUpAreaSqM ?? ''}
                      onChange={(e) => updateFloor(i, 'builtUpAreaSqM', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Built-Up Area (Sq.Ft.)</Label>
                    <Input
                      disabled={!canEdit}
                      type="number"
                      value={row.builtUpAreaSqFt ?? ''}
                      onChange={(e) => updateFloor(i, 'builtUpAreaSqFt', e.target.value)}
                    />
                  </div>
                  <div className="flex items-end gap-1">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => removeFloor(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">External Development Area (BLDA_005)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>External Dev Area (Sq.M.)</Label>
              <Input disabled={!canEdit} type="number" value={externalDevAreaSqM}
                onChange={(e) => setExternalDevAreaSqM(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>External Dev Area (Sq.Ft.)</Label>
              <Input disabled={!canEdit} type="number" value={externalDevAreaSqFt}
                onChange={(e) => setExternalDevAreaSqFt(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Industrial Structures / Sheds (BLDA_006)</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            disabled={!canEdit}
            rows={3}
            value={industrialStructures}
            onChange={(e) => setIndustrialStructures(e.target.value)}
            placeholder="Describe industrial structures, sheds, plant & machinery foundations, etc."
          />
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save External Dev'}
          </Button>
        </div>
      )}
    </div>
  );
}
