/**
 * GeneralSection — GEN_001–012
 * Displays and edits the assignment-level metadata: loan type, bank rep, fees, dates.
 * Data model: Assignment (saved via PATCH /assignments/:id/general)
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
import { useUpdateGeneralFields } from '../../../api/hooks/useAssignments.js';
import { LoanType } from '@valuemitra/shared';

const LOAN_TYPE_LABELS: Record<string, string> = {
  BUILDER: 'Builder / New Project',
  RESALE: 'Resale',
  TOP_UP: 'Top-Up',
  BALANCE_TRANSFER: 'Balance Transfer',
  HEHL: 'HEHL',
  LAP: 'Loan Against Property',
  APF: 'APF',
  OTHER: 'Other',
};

interface AssignmentDetail {
  id: string;
  assignmentNo: string;
  firmReferenceNo?: string | null;
  purposeOfValuation: string | null;
  propertyType: string;
  freshOrRevaluation?: string | null;
  loanType?: string | null;
  propertySubType?: string | null;
  bankBranchAddress?: string | null;
  bankRepresentative?: string | null;
  bankRefNo?: string | null;
  bankInstructionDate?: string | null;
  agreedFee?: number | null;
  feeGst?: number | null;
  referenceNote?: string | null;
  isUnderConstruction: boolean;
  percentageCompletion?: number | null;
  client?: {
    bankName?: string | null;
    bankCode?: string | null;
    isBank: boolean;
  } | null;
  assignedTo?: { fullName: string } | null;
}

interface Props {
  assignment: AssignmentDetail;
  canEdit: boolean;
}

export function GeneralSection({ assignment, canEdit }: Props) {
  const { toast } = useToast();
  const { mutate: saveGeneral, isPending } = useUpdateGeneralFields();

  const [form, setForm] = useState({
    loanType: assignment.loanType ?? '',
    propertySubType: assignment.propertySubType ?? '',
    freshOrRevaluation: assignment.freshOrRevaluation ?? '',
    bankRefNo: assignment.bankRefNo ?? '',
    bankInstructionDate: assignment.bankInstructionDate ? String(assignment.bankInstructionDate).slice(0, 10) : '',
    bankBranchAddress: assignment.bankBranchAddress ?? '',
    bankRepresentative: assignment.bankRepresentative ?? '',
    agreedFee: assignment.agreedFee != null ? String(assignment.agreedFee) : '',
    feeGst: assignment.feeGst != null ? String(assignment.feeGst) : '',
    referenceNote: assignment.referenceNote ?? '',
  });

  useEffect(() => {
    setForm({
      loanType: assignment.loanType ?? '',
      propertySubType: assignment.propertySubType ?? '',
      freshOrRevaluation: assignment.freshOrRevaluation ?? '',
      bankRefNo: assignment.bankRefNo ?? '',
      bankInstructionDate: assignment.bankInstructionDate ? String(assignment.bankInstructionDate).slice(0, 10) : '',
      bankBranchAddress: assignment.bankBranchAddress ?? '',
      bankRepresentative: assignment.bankRepresentative ?? '',
      agreedFee: assignment.agreedFee != null ? String(assignment.agreedFee) : '',
      feeGst: assignment.feeGst != null ? String(assignment.feeGst) : '',
      referenceNote: assignment.referenceNote ?? '',
    });
  }, [assignment.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    saveGeneral({
      id: assignment.id,
      data: {
        loanType: (form.loanType || null) as LoanType | null,
        propertySubType: form.propertySubType,
        freshOrRevaluation: (form.freshOrRevaluation || undefined) as 'Fresh' | 'Revaluation' | 'Review' | undefined,
        bankRefNo: form.bankRefNo,
        bankInstructionDate: form.bankInstructionDate || null,
        bankBranchAddress: form.bankBranchAddress,
        bankRepresentative: form.bankRepresentative,
        agreedFee: form.agreedFee ? parseFloat(form.agreedFee) : null,
        feeGst: form.feeGst ? parseFloat(form.feeGst) : null,
        referenceNote: form.referenceNote,
      },
    }, {
      onSuccess: () => toast({ title: 'General section saved' }),
      onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-4">
      {/* Read-only assignment info */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Assignment Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Assignment No</span>
            <p className="font-medium">{assignment.assignmentNo}</p>
          </div>
          {assignment.firmReferenceNo && (
            <div>
              <span className="text-muted-foreground">Firm Reference No</span>
              <p className="font-medium">{assignment.firmReferenceNo}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Purpose of Valuation</span>
            <p className="font-medium">{assignment.purposeOfValuation?.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Property Type</span>
            <p className="font-medium">{assignment.propertyType?.replace(/_/g, ' ')}</p>
          </div>
          {assignment.isUnderConstruction && (
            <div>
              <span className="text-muted-foreground">% Completion</span>
              <p className="font-medium">{assignment.percentageCompletion ?? '—'}%</p>
            </div>
          )}
          {assignment.assignedTo && (
            <div>
              <span className="text-muted-foreground">Assigned Valuer</span>
              <p className="font-medium">{assignment.assignedTo.fullName}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editable GEN fields */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Assignment Type & Classification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Fresh / Revaluation / Review</Label>
              <Select
                disabled={!canEdit}
                value={form.freshOrRevaluation || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, freshOrRevaluation: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  <SelectItem value="Fresh">Fresh</SelectItem>
                  <SelectItem value="Revaluation">Revaluation</SelectItem>
                  <SelectItem value="Review">Review</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Loan Type (INS_001)</Label>
              <Select
                disabled={!canEdit}
                value={form.loanType || '_none'}
                onValueChange={(v) => setForm((f) => ({ ...f, loanType: v === '_none' ? '' : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Select —</SelectItem>
                  {Object.entries(LOAN_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Property Sub-Type (INS_002)</Label>
            <Input
              disabled={!canEdit}
              value={form.propertySubType}
              onChange={(e) => setForm((f) => ({ ...f, propertySubType: e.target.value }))}
              placeholder="e.g. Residential Flat, Commercial Shop, Agricultural Land…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Bank Instruction Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Bank Reference No</Label>
              <Input
                disabled={!canEdit}
                value={form.bankRefNo}
                onChange={(e) => setForm((f) => ({ ...f, bankRefNo: e.target.value }))}
                placeholder="Bank's instruction reference"
              />
            </div>
            <div className="space-y-1">
              <Label>Bank Instruction Date</Label>
              <Input
                disabled={!canEdit}
                type="date"
                value={form.bankInstructionDate}
                onChange={(e) => setForm((f) => ({ ...f, bankInstructionDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Bank Branch Address (GEN_006)</Label>
            <Textarea
              disabled={!canEdit}
              rows={2}
              value={form.bankBranchAddress}
              onChange={(e) => setForm((f) => ({ ...f, bankBranchAddress: e.target.value }))}
              placeholder="Branch address where loan is processed"
            />
          </div>

          <div className="space-y-1">
            <Label>Bank RM / Contact Person (GEN_007)</Label>
            <Input
              disabled={!canEdit}
              value={form.bankRepresentative}
              onChange={(e) => setForm((f) => ({ ...f, bankRepresentative: e.target.value }))}
              placeholder="Bank officer name"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Fee Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Agreed Fee (₹)</Label>
              <Input
                disabled={!canEdit}
                type="number"
                value={form.agreedFee}
                onChange={(e) => setForm((f) => ({ ...f, agreedFee: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>GST on Fee (₹)</Label>
              <Input
                disabled={!canEdit}
                type="number"
                value={form.feeGst}
                onChange={(e) => setForm((f) => ({ ...f, feeGst: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Reference Note / Remarks</Label>
            <Textarea
              disabled={!canEdit}
              rows={2}
              value={form.referenceNote}
              onChange={(e) => setForm((f) => ({ ...f, referenceNote: e.target.value }))}
              placeholder="Internal notes for this assignment"
            />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-2" />
            {isPending ? 'Saving…' : 'Save General'}
          </Button>
        </div>
      )}
    </div>
  );
}
