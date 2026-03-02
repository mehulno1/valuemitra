import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileDown, Upload, Trash2, Bot, Lock, Send,
  CheckCircle2, XCircle, Plus, Save, TrendingUp, Building2, DollarSign,
} from 'lucide-react';
import { useAssignment } from '../../api/hooks/useAssignments.js';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../api/hooks/useDocuments.js';
import {
  useValuationRuns, useCreateValuationRun, useUpdateMarket, useUpdateCost,
  useUpdateIncome, useFinalizeValuation, useRequestAIValuation,
  type ComparableSale,
} from '../../api/hooks/useValuation.js';
import { useReports, useGenerateReport, useReportTemplates } from '../../api/hooks/useReports.js';
import { useSubmitForReview, useAdvanceReview, useRejectReview } from '../../api/hooks/useReview.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { StatusBadge } from '../../components/shared/StatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Separator } from '../../components/ui/separator.js';
import { useToast } from '../../hooks/use-toast.js';
import type { AssignmentStatus, DocumentType, ValuationApproach } from '@valuemitra/shared';

// ─── helpers ────────────────────────────────────────────────
function fmt(n?: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function num(s: string): number { return parseFloat(s) || 0; }

const OCR_BADGE: Record<string, string> = {
  PENDING:      'bg-slate-100 text-slate-600',
  QUEUED:       'bg-blue-100 text-blue-600',
  PROCESSING:   'bg-yellow-100 text-yellow-700',
  COMPLETED:    'bg-green-100 text-green-700',
  FAILED:       'bg-red-100 text-red-700',
  SKIPPED:      'bg-slate-100 text-slate-500',
  NEEDS_REVIEW: 'bg-orange-100 text-orange-700',
};

const DOC_TYPES = [
  { value: 'SALE_DEED',              label: 'Sale Deed' },
  { value: 'SEVEN_TWELVE_EXTRACT',   label: '7/12 Utara' },
  { value: 'EIGHT_A_EXTRACT',        label: '8-A Extract' },
  { value: 'PROPERTY_CARD',          label: 'Property Card' },
  { value: 'INDEX_II',               label: 'Index II' },
  { value: 'MUNICIPAL_TAX_RECEIPT',  label: 'Municipal Tax Receipt' },
  { value: 'BUILDING_PLAN_APPROVAL', label: 'Building Plan Approval' },
  { value: 'COMPLETION_CERTIFICATE', label: 'Completion Certificate' },
  { value: 'OCCUPANCY_CERTIFICATE',  label: 'Occupancy Certificate' },
  { value: 'SITE_PHOTOGRAPH',        label: 'Site Photograph' },
  { value: 'LOCATION_MAP',           label: 'Location Map' },
  { value: 'OTHER',                  label: 'Other' },
];

const REVIEW_STEPS = ['INTERNAL_REVIEW', 'CLIENT_BANK_REVIEW', 'COMPLIANCE_CHECK', 'APPROVED', 'DELIVERED'];

// ─── Documents Tab ─────────────────────────────────────────
function DocumentsTab({ assignmentId, canEdit }: { assignmentId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data: docs, isLoading } = useDocuments(assignmentId);
  const { mutate: upload, isPending: uploading } = useUploadDocument();
  const { mutate: deleteDoc } = useDeleteDocument();
  const [docType, setDocType] = useState<string>('OTHER');

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    upload(
      { assignmentId, file, documentType: docType },
      {
        onSuccess: () => toast({ title: 'Document uploaded' }),
        onError: () => toast({ title: 'Upload failed', variant: 'destructive' }),
      },
    );
    e.target.value = '';
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label>Document Type</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Label htmlFor="doc-upload" className="cursor-pointer">
                <Button asChild disabled={uploading} variant="outline">
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading ? 'Uploading…' : 'Upload File'}
                  </span>
                </Button>
              </Label>
              <input id="doc-upload" type="file" className="hidden" onChange={handleFile} />
            </div>
          </CardContent>
        </Card>
      )}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>OCR Status</TableHead>
              <TableHead>Uploaded</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(docs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                  No documents uploaded yet.
                </TableCell>
              </TableRow>
            )}
            {(docs ?? []).map((doc) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <a href={doc.signedUrl} target="_blank" rel="noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1">
                    <FileDown className="h-3 w-3" />{doc.fileName}
                  </a>
                  <span className="text-xs text-muted-foreground">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                </TableCell>
                <TableCell className="text-sm">{doc.documentType.replace(/_/g, ' ')}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OCR_BADGE[doc.ocrStatus] ?? ''}`}>
                    {doc.ocrStatus}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(doc.createdAt).toLocaleDateString('en-IN')}
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <button onClick={() => deleteDoc({ id: doc.id, assignmentId }, {
                      onSuccess: () => toast({ title: 'Deleted' }),
                      onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
                    })} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Market Comparable Dialog ───────────────────────────────
const EMPTY_COMP: Omit<ComparableSale, 'id'> = {
  address: '', locality: '', transactionDate: '', totalArea: 0, salePrice: 0,
  sourceType: 'MANUAL', adjustmentTime: 0, adjustmentLocation: 0,
  adjustmentSize: 0, adjustmentCondition: 0, adjustmentAmenities: 0,
};

function ComparableDialog({
  open, onClose, onSave,
}: { open: boolean; onClose: () => void; onSave: (c: Omit<ComparableSale, 'id'>) => void }) {
  const [form, setForm] = useState({ ...EMPTY_COMP, transactionDate: new Date().toISOString().slice(0, 10) });
  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.type === 'number' ? num(e.target.value) : e.target.value }));

  function handleSave() {
    if (!form.address || !form.locality || !form.totalArea || !form.salePrice) return;
    const dateISO = form.transactionDate.includes('T') ? form.transactionDate : `${form.transactionDate}T00:00:00.000Z`;
    onSave({ ...form, transactionDate: dateISO });
    setForm({ ...EMPTY_COMP, transactionDate: new Date().toISOString().slice(0, 10) });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Comparable Sale</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1">
            <Label>Address *</Label>
            <Input value={form.address} onChange={f('address')} placeholder="Full address of comparable property" />
          </div>
          <div className="space-y-1">
            <Label>Locality *</Label>
            <Input value={form.locality} onChange={f('locality')} placeholder="e.g. Thane West" />
          </div>
          <div className="space-y-1">
            <Label>Transaction Date *</Label>
            <Input type="date" value={form.transactionDate} onChange={f('transactionDate')} />
          </div>
          <div className="space-y-1">
            <Label>Total Area (sq.ft.) *</Label>
            <Input type="number" value={form.totalArea || ''} onChange={f('totalArea')} placeholder="1200" />
          </div>
          <div className="space-y-1">
            <Label>Sale Price (₹) *</Label>
            <Input type="number" value={form.salePrice || ''} onChange={f('salePrice')} placeholder="5000000" />
          </div>
          <div className="space-y-1">
            <Label>Source</Label>
            <Select value={form.sourceType} onValueChange={(v) => setForm((p) => ({ ...p, sourceType: v as ComparableSale['sourceType'] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IGRS">IGRS / IGR Portal</SelectItem>
                <SelectItem value="LISTING">Market Listing</SelectItem>
                <SelectItem value="MANUAL">Manual Entry</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Rate / sq.ft.</Label>
            <Input readOnly value={form.totalArea > 0 ? `₹${Math.round(form.salePrice / form.totalArea).toLocaleString('en-IN')}` : '—'} className="bg-muted" />
          </div>
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Adjustments (%) — positive = better than subject</p>
        <div className="grid grid-cols-5 gap-3">
          {(['adjustmentTime', 'adjustmentLocation', 'adjustmentSize', 'adjustmentCondition', 'adjustmentAmenities'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{k.replace('adjustment', '')}</Label>
              <Input type="number" value={(form[k] as number) || ''} onChange={f(k)} placeholder="0" className="text-sm" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.address || !form.locality || !form.totalArea || !form.salePrice}>
            Add Comparable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Valuation Tab ─────────────────────────────────────────
function ValuationTab({ assignmentId, canEdit }: { assignmentId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data: runs, isLoading } = useValuationRuns(assignmentId);
  const { mutate: createRun, isPending: creating } = useCreateValuationRun();
  const { mutate: updateMarket, isPending: savingMarket } = useUpdateMarket();
  const { mutate: updateCost, isPending: savingCost } = useUpdateCost();
  const { mutate: updateIncome, isPending: savingIncome } = useUpdateIncome();
  const { mutate: finalize, isPending: finalizing } = useFinalizeValuation();
  const { mutate: requestAI, isPending: aiLoading } = useRequestAIValuation();

  const run = runs?.[0];

  // Market comparables state
  const [comparables, setComparables] = useState<Omit<ComparableSale, 'id'>[]>([]);
  const [showCompDialog, setShowCompDialog] = useState(false);
  const [correlatedValue, setCorrelatedValue] = useState('');

  // Cost approach state
  const [cost, setCost] = useState({
    landArea: '', landRatePerSqM: '', landRateSource: 'market',
    buildingPlinthArea: '', buildingRatePerSqM: '',
    ageYears: '', totalLifeYears: '60',
    depreciationMethod: 'STRAIGHT_LINE',
    servicesCostPercent: '5',
  });

  // Income approach state
  const [income, setIncome] = useState({
    grossRent: '', vacancyRate: '5', operatingExpenses: '', capitalizationRate: '8',
  });

  // Finalize state
  const [weights, setWeights] = useState({ market: '33', cost: '33', income: '34' });
  const [notes, setNotes] = useState('');

  // Sync from server data when run loads
  useEffect(() => {
    if (!run) return;
    if (run.comparables?.length) setComparables(run.comparables as Omit<ComparableSale, 'id'>[]);
    if (run.correlatedValue) setCorrelatedValue(String(run.correlatedValue));
    if (run.landRateUsed) setCost((p) => ({ ...p, landRatePerSqM: String(run.landRateUsed ?? '') }));
    if (run.buildingPlinthArea) setCost((p) => ({ ...p, buildingPlinthArea: String(run.buildingPlinthArea ?? '') }));
    if (run.buildingRatePerSqM) setCost((p) => ({ ...p, buildingRatePerSqM: String(run.buildingRatePerSqM ?? '') }));
    if (run.grossRent) setIncome((p) => ({ ...p, grossRent: String(run.grossRent ?? '') }));
    if (run.capitalizationRate) setIncome((p) => ({ ...p, capitalizationRate: String((run.capitalizationRate ?? 0) * 100) }));
    if (run.reconciliationNotes) setNotes(run.reconciliationNotes);
    if (run.marketApproachWeight) setWeights({ market: String((run.marketApproachWeight ?? 0) * 100), cost: String((run.costApproachWeight ?? 0) * 100), income: String((run.incomeApproachWeight ?? 0) * 100) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  function handleCreate(approach: ValuationApproach) {
    createRun({ assignmentId, approach }, {
      onSuccess: () => toast({ title: 'Valuation run started' }),
      onError: () => toast({ title: 'Failed to create run', variant: 'destructive' }),
    });
  }

  function handleSaveMarket() {
    if (!run || comparables.length === 0) return;
    const dateFixed = comparables.map((c) => ({
      ...c,
      transactionDate: c.transactionDate.includes('T') ? c.transactionDate : `${c.transactionDate}T00:00:00.000Z`,
    }));
    updateMarket({ id: run.id, assignmentId, data: { comparables: dateFixed, correlatedValue: num(correlatedValue) || undefined } }, {
      onSuccess: () => toast({ title: 'Market data saved' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed', variant: 'destructive' }),
    });
  }

  function handleSaveCost() {
    if (!run) return;
    updateCost({ id: run.id, assignmentId, data: {
      landArea: num(cost.landArea) || undefined,
      landRatePerSqM: num(cost.landRatePerSqM) || undefined,
      landRateSource: cost.landRateSource,
      buildingPlinthArea: num(cost.buildingPlinthArea) || undefined,
      buildingRatePerSqM: num(cost.buildingRatePerSqM) || undefined,
      ageYears: num(cost.ageYears) || undefined,
      totalLifeYears: num(cost.totalLifeYears) || undefined,
      depreciationMethod: cost.depreciationMethod,
      servicesCostPercent: num(cost.servicesCostPercent) || undefined,
    }}, {
      onSuccess: () => toast({ title: 'Cost data saved & computed' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed', variant: 'destructive' }),
    });
  }

  function handleSaveIncome() {
    if (!run) return;
    updateIncome({ id: run.id, assignmentId, data: {
      grossRent: num(income.grossRent),
      vacancyRate: num(income.vacancyRate) / 100,
      operatingExpenses: num(income.operatingExpenses),
      capitalizationRate: num(income.capitalizationRate) / 100,
    }}, {
      onSuccess: () => toast({ title: 'Income data saved & computed' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed', variant: 'destructive' }),
    });
  }

  function handleFinalize() {
    if (!run) return;
    const mw = num(weights.market) / 100;
    const cw = num(weights.cost) / 100;
    const iw = num(weights.income) / 100;
    const total = mw + cw + iw;
    if (Math.abs(total - 1) > 0.001 && total !== 0) {
      toast({ title: 'Weights must sum to 100%', variant: 'destructive' }); return;
    }
    finalize({ id: run.id, assignmentId, data: {
      marketApproachWeight: mw || undefined,
      costApproachWeight: cw || undefined,
      incomeApproachWeight: iw || undefined,
      reconciliationNotes: notes || undefined,
    }}, {
      onSuccess: () => toast({ title: 'Valuation finalized!' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Finalization failed', variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  // No run — choose approach
  if (!run) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Start Valuation</CardTitle><CardDescription>Choose the primary valuation approach</CardDescription></CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          {(['MARKET_COMPARISON', 'COST_APPROACH', 'INCOME_APPROACH', 'COMBINED'] as ValuationApproach[]).map((a) => (
            <Button key={a} variant="outline" disabled={creating || !canEdit} onClick={() => handleCreate(a)}>
              {a === 'MARKET_COMPARISON' && <TrendingUp className="h-4 w-4 mr-2" />}
              {a === 'COST_APPROACH' && <Building2 className="h-4 w-4 mr-2" />}
              {a === 'INCOME_APPROACH' && <DollarSign className="h-4 w-4 mr-2" />}
              {a.replace(/_/g, ' ')}
            </Button>
          ))}
        </CardContent>
      </Card>
    );
  }

  const approach = run.approach;
  const isMarket = approach === 'MARKET_COMPARISON' || approach === 'COMBINED';
  const isCost   = approach === 'COST_APPROACH'   || approach === 'COMBINED';
  const isIncome = approach === 'INCOME_APPROACH'  || approach === 'COMBINED';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold">{approach.replace(/_/g, ' ')}</span>
          {' '}
          <Badge variant={run.isFinalized ? 'default' : 'secondary'}>
            {run.isFinalized ? '✅ Finalized' : 'In progress'}
          </Badge>
        </div>
        {canEdit && !run.isFinalized && (
          <Button size="sm" variant="outline" disabled={aiLoading} onClick={() => requestAI(assignmentId, {
            onSuccess: () => toast({ title: 'AI opinion requested' }),
            onError: () => toast({ title: 'AI advisory failed', variant: 'destructive' }),
          })}>
            <Bot className="h-4 w-4 mr-1" /> AI Advisory
          </Button>
        )}
      </div>

      {/* ── Market Comparison ── */}
      {isMarket && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Market Comparison</CardTitle>
              {canEdit && !run.isFinalized && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowCompDialog(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Add Comparable
                  </Button>
                  <Button size="sm" disabled={comparables.length === 0 || savingMarket} onClick={handleSaveMarket}>
                    <Save className="h-3 w-3 mr-1" />{savingMarket ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparables.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No comparables added yet. Click "Add Comparable" to begin.</p>
            ) : (
              <div className="border rounded text-sm overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address / Locality</TableHead>
                      <TableHead className="text-right">Area (sq.ft.)</TableHead>
                      <TableHead className="text-right">Sale Price</TableHead>
                      <TableHead className="text-right">Rate/sq.ft.</TableHead>
                      <TableHead>Date</TableHead>
                      {!run.isFinalized && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparables.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="font-medium text-xs">{c.address}</div>
                          <div className="text-muted-foreground text-xs">{c.locality}</div>
                        </TableCell>
                        <TableCell className="text-right">{c.totalArea.toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right">{fmt(c.salePrice)}</TableCell>
                        <TableCell className="text-right text-primary font-semibold">
                          {c.totalArea > 0 ? `₹${Math.round(c.salePrice / c.totalArea).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{c.transactionDate ? new Date(c.transactionDate).toLocaleDateString('en-IN') : '—'}</TableCell>
                        {!run.isFinalized && (
                          <TableCell>
                            <button onClick={() => setComparables((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                              <XCircle className="h-4 w-4" />
                            </button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {run.correlatedValue && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Correlated Value:</span>
                <span className="font-bold text-primary">{fmt(run.correlatedValue)}</span>
              </div>
            )}
            {canEdit && !run.isFinalized && comparables.length > 0 && (
              <div className="flex items-center gap-3">
                <Label className="text-sm whitespace-nowrap">Adopted Value (₹)</Label>
                <Input type="number" className="max-w-[200px]" value={correlatedValue} onChange={(e) => setCorrelatedValue(e.target.value)} placeholder="Override correlated value" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Cost Approach ── */}
      {isCost && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" />Cost Approach</CardTitle>
              {canEdit && !run.isFinalized && (
                <Button size="sm" disabled={savingCost} onClick={handleSaveCost}>
                  <Save className="h-3 w-3 mr-1" />{savingCost ? 'Computing…' : 'Save & Compute'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Land Area (sq.m.)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.landArea} onChange={(e) => setCost((p) => ({ ...p, landArea: e.target.value }))} placeholder="500" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Land Rate (₹/sq.m.)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.landRatePerSqM} onChange={(e) => setCost((p) => ({ ...p, landRatePerSqM: e.target.value }))} placeholder="15000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Land Rate Source</Label>
                <Select disabled={run.isFinalized || !canEdit} value={cost.landRateSource} onValueChange={(v) => setCost((p) => ({ ...p, landRateSource: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="govt_rr">Govt. Ready Reckoner</SelectItem>
                    <SelectItem value="market">Market Rate</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Building Plinth Area (sq.m.)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.buildingPlinthArea} onChange={(e) => setCost((p) => ({ ...p, buildingPlinthArea: e.target.value }))} placeholder="200" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Construction Rate (₹/sq.m.)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.buildingRatePerSqM} onChange={(e) => setCost((p) => ({ ...p, buildingRatePerSqM: e.target.value }))} placeholder="25000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Depreciation Method</Label>
                <Select disabled={run.isFinalized || !canEdit} value={cost.depreciationMethod} onValueChange={(v) => setCost((p) => ({ ...p, depreciationMethod: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STRAIGHT_LINE">Straight Line</SelectItem>
                    <SelectItem value="WDV">Written Down Value</SelectItem>
                    <SelectItem value="OBSERVED_CONDITION">Observed Condition</SelectItem>
                    <SelectItem value="CPWD_SCHEDULE">CPWD Schedule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Age of Building (years)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.ageYears} onChange={(e) => setCost((p) => ({ ...p, ageYears: e.target.value }))} placeholder="15" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Life (years)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.totalLifeYears} onChange={(e) => setCost((p) => ({ ...p, totalLifeYears: e.target.value }))} placeholder="60" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Services Cost (%)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={cost.servicesCostPercent} onChange={(e) => setCost((p) => ({ ...p, servicesCostPercent: e.target.value }))} placeholder="5" />
              </div>
            </div>
            {/* Computed results */}
            {(run.landValue || run.costApproachValue) && (
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                {run.landValue != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Land Value</p><p className="font-semibold">{fmt(run.landValue)}</p></div>}
                {run.depreciatedValue != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Depr. Building Value</p><p className="font-semibold">{fmt(run.depreciatedValue)}</p></div>}
                {run.costApproachValue != null && <div className="bg-primary/10 border border-primary/20 rounded p-3"><p className="text-xs text-muted-foreground">Cost Approach Value</p><p className="font-bold text-primary">{fmt(run.costApproachValue)}</p></div>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Income Approach ── */}
      {isIncome && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Income Approach</CardTitle>
              {canEdit && !run.isFinalized && (
                <Button size="sm" disabled={savingIncome} onClick={handleSaveIncome}>
                  <Save className="h-3 w-3 mr-1" />{savingIncome ? 'Computing…' : 'Save & Compute'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Monthly Gross Rent (₹)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={income.grossRent} onChange={(e) => setIncome((p) => ({ ...p, grossRent: e.target.value }))} placeholder="50000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vacancy Rate (%)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={income.vacancyRate} onChange={(e) => setIncome((p) => ({ ...p, vacancyRate: e.target.value }))} placeholder="5" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Annual Operating Expenses (₹)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={income.operatingExpenses} onChange={(e) => setIncome((p) => ({ ...p, operatingExpenses: e.target.value }))} placeholder="30000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cap Rate (%)</Label>
                <Input type="number" disabled={run.isFinalized || !canEdit} value={income.capitalizationRate} onChange={(e) => setIncome((p) => ({ ...p, capitalizationRate: e.target.value }))} placeholder="8" />
              </div>
            </div>
            {run.incomeApproachValue != null && (
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                {run.netOperatingIncome != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Net Operating Income (Annual)</p><p className="font-semibold">{fmt(run.netOperatingIncome)}</p></div>}
                {run.capitalizationRate != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Cap Rate</p><p className="font-semibold">{((run.capitalizationRate) * 100).toFixed(2)}%</p></div>}
                <div className="bg-primary/10 border border-primary/20 rounded p-3"><p className="text-xs text-muted-foreground">Income Approach Value</p><p className="font-bold text-primary">{fmt(run.incomeApproachValue)}</p></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Finalize ── */}
      {canEdit && !run.isFinalized && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4" />Finalize Valuation</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {approach === 'COMBINED' && (
              <div className="grid grid-cols-3 gap-4">
                {isMarket && <div className="space-y-1"><Label className="text-xs">Market Weight (%)</Label><Input type="number" value={weights.market} onChange={(e) => setWeights((p) => ({ ...p, market: e.target.value }))} /></div>}
                {isCost && <div className="space-y-1"><Label className="text-xs">Cost Weight (%)</Label><Input type="number" value={weights.cost} onChange={(e) => setWeights((p) => ({ ...p, cost: e.target.value }))} /></div>}
                {isIncome && <div className="space-y-1"><Label className="text-xs">Income Weight (%)</Label><Input type="number" value={weights.income} onChange={(e) => setWeights((p) => ({ ...p, income: e.target.value }))} /></div>}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Reconciliation Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain your valuation rationale and adopted value…" rows={3} />
            </div>
            <Button disabled={finalizing} onClick={handleFinalize}>
              <Lock className="h-4 w-4 mr-2" />{finalizing ? 'Finalizing…' : 'Finalize Valuation'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Final Value ── */}
      {run.roundedValue != null && (
        <Card className="border-primary">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Final Adopted Value</p>
              <p className="text-3xl font-bold text-primary">{fmt(run.roundedValue)}</p>
            </div>
            {run.isFinalized && <Lock className="h-6 w-6 text-muted-foreground" />}
          </CardContent>
        </Card>
      )}

      {/* ── AI Advisory ── */}
      {run.aiValuationResult && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> AI Advisory Opinion</CardTitle>
            <CardDescription>Advisory only — does not override your decision</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-xs text-muted-foreground">Low</p><p className="font-semibold">{fmt(run.aiValuationResult.suggestedValueLow)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mid</p><p className="font-bold text-lg">{fmt(run.aiValuationResult.suggestedValueMid)}</p></div>
              <div><p className="text-xs text-muted-foreground">High</p><p className="font-semibold">{fmt(run.aiValuationResult.suggestedValueHigh)}</p></div>
            </div>
            <Separator />
            <p className="text-sm">{run.aiValuationResult.reasoning}</p>
            <p className="text-xs text-muted-foreground">Confidence: {run.aiValuationResult.confidenceLevel}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Comparable dialog ── */}
      <ComparableDialog open={showCompDialog} onClose={() => setShowCompDialog(false)} onSave={(c) => setComparables((p) => [...p, c])} />
    </div>
  );
}

// ─── Reports Tab ────────────────────────────────────────────
function ReportsTab({ assignmentId, canEdit }: { assignmentId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data: reports, isLoading } = useReports(assignmentId);
  const { data: templates } = useReportTemplates();
  const { mutate: generate, isPending: generating } = useGenerateReport();
  const [selectedTemplate, setSelectedTemplate] = useState('');

  function handleGenerate() {
    if (!selectedTemplate) return;
    generate({ assignmentId, templateId: selectedTemplate }, {
      onSuccess: () => toast({ title: 'Report generated successfully' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Generation failed', variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label>Select Report Template</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger><SelectValue placeholder="Choose a report template…" /></SelectTrigger>
                  <SelectContent>
                    {(templates ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {t.bankCode} / {t.propertyType.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={!selectedTemplate || generating} onClick={handleGenerate}>
                {generating ? 'Generating…' : 'Generate Report'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Generated</TableHead>
              <TableHead>Downloads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(reports ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                  No reports generated yet.
                </TableCell>
              </TableRow>
            )}
            {(reports ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">{(r as unknown as { template?: { name?: string } }).template?.name ?? '—'}</TableCell>
                <TableCell className="text-sm">v{(r as unknown as { version?: number }).version ?? 1}</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {(r as unknown as { generatedAt?: string }).generatedAt ? new Date((r as unknown as { generatedAt: string }).generatedAt).toLocaleDateString('en-IN') : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {(r as unknown as { pdfSignedUrl?: string }).pdfSignedUrl && (
                      <a href={(r as unknown as { pdfSignedUrl: string }).pdfSignedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">PDF</a>
                    )}
                    {(r as unknown as { docxSignedUrl?: string }).docxSignedUrl && (
                      <a href={(r as unknown as { docxSignedUrl: string }).docxSignedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">DOCX</a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Review Tab ─────────────────────────────────────────────
function ReviewTab({ assignmentId, status, reports }: { assignmentId: string; status: AssignmentStatus; reports: { id: string }[] }) {
  const { toast } = useToast();
  const { canReview, canEdit } = usePermissions();
  const { mutate: submit, isPending: submitting } = useSubmitForReview();
  const { mutate: advance, isPending: advancing } = useAdvanceReview();
  const { mutate: reject, isPending: rejecting } = useRejectReview();
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isInReview = REVIEW_STEPS.includes(status);
  const currentStep = REVIEW_STEPS.indexOf(status);
  const firstReport = reports?.[0];

  function handleSubmit() {
    if (!firstReport) { toast({ title: 'Generate a report first', variant: 'destructive' }); return; }
    submit({ assignmentId, data: { reportId: firstReport.id } }, {
      onSuccess: () => toast({ title: 'Submitted for review' }),
      onError: () => toast({ title: 'Submit failed', variant: 'destructive' }),
    });
  }

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-0">
        {REVIEW_STEPS.map((step, i) => {
          const done = currentStep > i;
          const active = currentStep === i;
          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  done ? 'bg-green-500 border-green-500 text-white' :
                  active ? 'border-primary bg-primary text-primary-foreground' :
                  'border-muted-foreground/30 text-muted-foreground'
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-xs mt-1 text-center text-muted-foreground max-w-[80px]">
                  {step.replace(/_/g, ' ')}
                </span>
              </div>
              {i < REVIEW_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 -mt-5 ${done ? 'bg-green-500' : 'bg-muted'}`} />
              )}
            </div>
          );
        })}
      </div>
      <Separator />
      <div className="flex gap-3 flex-wrap">
        {status === 'REPORT_DRAFT' && canEdit && (
          <Button disabled={submitting || !firstReport} onClick={handleSubmit}>
            <Send className="h-4 w-4 mr-2" />{submitting ? 'Submitting…' : 'Submit for Internal Review'}
          </Button>
        )}
        {isInReview && status !== 'DELIVERED' && canReview && (
          <>
            <Button disabled={advancing} onClick={() => advance({ assignmentId }, {
              onSuccess: () => toast({ title: 'Review advanced' }),
              onError: () => toast({ title: 'Failed', variant: 'destructive' }),
            })}>
              <CheckCircle2 className="h-4 w-4 mr-2" />{advancing ? 'Advancing…' : 'Advance'}
            </Button>
            <Button variant="destructive" onClick={() => setRejectDialog(true)}>
              <XCircle className="h-4 w-4 mr-2" /> Reject
            </Button>
          </>
        )}
        {status === 'DELIVERED' && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" /><span className="font-medium">Report delivered</span>
          </div>
        )}
      </div>
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject & Return to Draft</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason (required, min 10 characters)</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Explain why the report is being returned…" rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectReason.length < 10 || rejecting}
              onClick={() => reject({ assignmentId, data: { reason: rejectReason } }, {
                onSuccess: () => { toast({ title: 'Rejected — back to draft' }); setRejectDialog(false); },
                onError: () => toast({ title: 'Reject failed', variant: 'destructive' }),
              })}>
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function AssignmentDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const { data: assignment, isLoading, isError } = useAssignment(assignmentId!);
  const { data: reportsData } = useReports(assignmentId!);

  if (isLoading) return <LoadingSpinner />;
  if (isError || !assignment) return <p className="text-destructive text-sm">Assignment not found.</p>;

  const prop = (assignment as unknown as { property?: { addressLine1?: string; city?: string; state?: string; landAreaSqM?: number; builtUpAreaSqM?: number } })?.property;
  const client = (assignment as unknown as { client?: { fullName?: string; companyName?: string; bankName?: string; isBank?: boolean; clientType?: string } })?.client;
  const clientName = client?.isBank ? (client.bankName ?? client.companyName) :
    (client?.clientType === 'INDIVIDUAL' ? client.fullName : (client?.companyName ?? client?.fullName));
  const status = assignment.status as AssignmentStatus;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate('/assignments')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Assignments
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold font-mono">{assignment.assignmentNo}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-muted-foreground text-sm">
            {clientName ?? '—'} · {assignment.propertyType?.replace(/_/g, ' ')} · {assignment.propertyCity}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="valuation">Valuation</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Property</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Address: </span>{prop?.addressLine1 ?? (assignment as unknown as { propertyAddress?: string }).propertyAddress}</div>
                <div><span className="text-muted-foreground">City: </span>{prop?.city ?? assignment.propertyCity}</div>
                <div><span className="text-muted-foreground">State: </span>{prop?.state}</div>
                {prop?.landAreaSqM && <div><span className="text-muted-foreground">Land Area: </span>{prop.landAreaSqM} sqm</div>}
                {prop?.builtUpAreaSqM && <div><span className="text-muted-foreground">Built-up: </span>{prop.builtUpAreaSqM} sqm</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Assignment Info</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Client: </span>{clientName ?? '—'}</div>
                <div><span className="text-muted-foreground">Purpose: </span>{(assignment as unknown as { purposeOfValuation?: string }).purposeOfValuation?.replace(/_/g, ' ')}</div>
                <div><span className="text-muted-foreground">Inspection: </span>{assignment.inspectionDate ? new Date(assignment.inspectionDate).toLocaleDateString('en-IN') : '—'}</div>
                {(assignment as unknown as { finalValue?: number }).finalValue && (
                  <div><span className="text-muted-foreground">Final Value: </span><span className="font-bold text-primary">{fmt((assignment as unknown as { finalValue?: number }).finalValue)}</span></div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="valuation">
          <ValuationTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="review">
          <ReviewTab assignmentId={assignmentId!} status={status} reports={reportsData ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
