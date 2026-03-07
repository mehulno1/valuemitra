/**
 * OwnerSection — OWN_001–008
 * Owner names, contacts, borrower name, developer name.
 * Data model: Property (saved via PATCH /property-data/:id)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Input } from '../../ui/input.js';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { Save, Plus, X } from 'lucide-react';
import { useToast } from '../../../hooks/use-toast.js';
import { useSavePropertyData } from '../../../api/hooks/usePropertyData.js';
import type { PropertyDataResponse } from '../../../api/hooks/usePropertyData.js';

interface Props {
  assignmentId: string;
  propertyType: string;
  propertyData: PropertyDataResponse | undefined;
  canEdit: boolean;
}

export function OwnerSection({ assignmentId, propertyType: _propertyType, propertyData, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: save, isPending } = useSavePropertyData();
  const p = propertyData?.property;

  const [ownerNames, setOwnerNames] = useState<string[]>(p?.ownerNames ?? []);
  const [newOwner, setNewOwner] = useState('');
  const [form, setForm] = useState({
    ownershipNature: p?.ownershipNature ?? '',
    ownerShareDetails: p?.ownerShareDetails ?? '',
    ownerAddress: (p as { ownerAddress?: string | null } | undefined)?.ownerAddress ?? '',
    ownerContact: (p as { ownerContact?: string | null } | undefined)?.ownerContact ?? '',
    ownerPan: (p as { ownerPan?: string | null } | undefined)?.ownerPan ?? '',
    borrowerName: (p as { borrowerName?: string | null } | undefined)?.borrowerName ?? '',
    developerName: p?.developerName ?? '',
    reraNo: p?.reraNo ?? '',
  });

  useEffect(() => {
    setOwnerNames(p?.ownerNames ?? []);
    setForm({
      ownershipNature: p?.ownershipNature ?? '',
      ownerShareDetails: p?.ownerShareDetails ?? '',
      ownerAddress: (p as { ownerAddress?: string | null } | undefined)?.ownerAddress ?? '',
      ownerContact: (p as { ownerContact?: string | null } | undefined)?.ownerContact ?? '',
      ownerPan: (p as { ownerPan?: string | null } | undefined)?.ownerPan ?? '',
      borrowerName: (p as { borrowerName?: string | null } | undefined)?.borrowerName ?? '',
      developerName: p?.developerName ?? '',
      reraNo: p?.reraNo ?? '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function addOwner() {
    const name = newOwner.trim();
    if (!name) return;
    setOwnerNames((prev) => [...prev, name]);
    setNewOwner('');
  }

  function removeOwner(i: number) {
    setOwnerNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSave() {
    save({
      assignmentId,
      data: {
        ownerNames,
        ownershipNature: form.ownershipNature,
        ownerShareDetails: form.ownerShareDetails,
        ownerAddress: form.ownerAddress,
        ownerContact: form.ownerContact,
        ownerPan: form.ownerPan,
        borrowerName: form.borrowerName,
        developerName: form.developerName,
        reraNo: form.reraNo,
      },
    }, {
      onSuccess: () => toast({ title: 'Owner section saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Owner Names (OWN_001)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {ownerNames.map((name, i) => (
              <Badge key={i} variant="secondary" className="text-sm gap-1">
                {name}
                {canEdit && (
                  <button onClick={() => removeOwner(i)} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {ownerNames.length === 0 && <span className="text-sm text-muted-foreground">No owners added</span>}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Input
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOwner()}
                placeholder="Add owner name…"
                className="max-w-xs"
              />
              <Button size="sm" variant="outline" onClick={addOwner}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Ownership Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Nature of Ownership (OWN_005)</Label>
              <Input
                disabled={!canEdit}
                value={form.ownershipNature}
                onChange={(e) => setForm((f) => ({ ...f, ownershipNature: e.target.value }))}
                placeholder="Individual / Joint / Company / HUF / Partnership"
              />
            </div>
            <div className="space-y-1">
              <Label>Share Details (OWN_006)</Label>
              <Input
                disabled={!canEdit}
                value={form.ownerShareDetails}
                onChange={(e) => setForm((f) => ({ ...f, ownerShareDetails: e.target.value }))}
                placeholder="e.g. 50% each"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Owner Address (OWN_002)</Label>
            <Input
              disabled={!canEdit}
              value={form.ownerAddress}
              onChange={(e) => setForm((f) => ({ ...f, ownerAddress: e.target.value }))}
              placeholder="Owner's correspondence address"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Owner Contact (OWN_003)</Label>
              <Input
                disabled={!canEdit}
                value={form.ownerContact}
                onChange={(e) => setForm((f) => ({ ...f, ownerContact: e.target.value }))}
                placeholder="Phone / Email"
              />
            </div>
            <div className="space-y-1">
              <Label>Owner PAN (OWN_004)</Label>
              <Input
                disabled={!canEdit}
                value={form.ownerPan}
                onChange={(e) => setForm((f) => ({ ...f, ownerPan: e.target.value.toUpperCase() }))}
                placeholder="AAAAA0000A"
                maxLength={10}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Borrower / Developer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Borrower / Applicant Name (OWN_007)</Label>
            <Input
              disabled={!canEdit}
              value={form.borrowerName}
              onChange={(e) => setForm((f) => ({ ...f, borrowerName: e.target.value }))}
              placeholder="Loan applicant name (may differ from owner)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Developer / Builder Name (OWN_008)</Label>
              <Input
                disabled={!canEdit}
                value={form.developerName}
                onChange={(e) => setForm((f) => ({ ...f, developerName: e.target.value }))}
                placeholder="Builder / Developer name"
              />
            </div>
            <div className="space-y-1">
              <Label>RERA Registration No</Label>
              <Input
                disabled={!canEdit}
                value={form.reraNo}
                onChange={(e) => setForm((f) => ({ ...f, reraNo: e.target.value }))}
                placeholder="RERA number"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save Owner'}
          </Button>
        </div>
      )}
    </div>
  );
}
