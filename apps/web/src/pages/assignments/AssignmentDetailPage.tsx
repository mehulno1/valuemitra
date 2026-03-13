import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileDown, Upload, Trash2, Bot, Lock, Send,
  CheckCircle2, XCircle, Plus, Save, TrendingUp, Building2, DollarSign,
  AlertTriangle,
} from 'lucide-react';
import { useAssignment } from '../../api/hooks/useAssignments.js';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../api/hooks/useDocuments.js';
import {
  useValuationRuns, useCreateValuationRun, useUpdateMarket, useUpdateCost,
  useUpdateIncome, useFinalizeValuation, useRequestAIValuation, useDeleteValuationRun,
  type ComparableSale,
} from '../../api/hooks/useValuation.js';
import { useReports, useGenerateReport, useReportTemplates } from '../../api/hooks/useReports.js';
import { useSubmitForReview, useAdvanceReview, useRejectReview, useDeliverFinalReport } from '../../api/hooks/useReview.js';
import { usePropertyData, useExtractPropertyData, useSavePropertyData } from '../../api/hooks/usePropertyData.js';
import { useInspection } from '../../api/hooks/useInspections.js';
import type { ExtractedPropertyData } from '@valuemitra/shared';
import { usePermissions } from '../../hooks/usePermissions.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { StatusBadge } from '../../components/shared/StatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Alert, AlertDescription } from '../../components/ui/alert.js';
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
import { getTabsForType, TAB_LABELS } from '../../lib/assignment-tabs.js';
import { GeneralSection } from '../../components/assignment/sections/GeneralSection.js';
import { OwnerSection } from '../../components/assignment/sections/OwnerSection.js';
import { LocationSection } from '../../components/assignment/sections/LocationSection.js';
import { AreaSection } from '../../components/assignment/sections/AreaSection.js';
import { PhysicalSection } from '../../components/assignment/sections/PhysicalSection.js';
import { LandSection } from '../../components/assignment/sections/LandSection.js';
import { BoundarySection } from '../../components/assignment/sections/BoundarySection.js';
import { BuildingSection } from '../../components/assignment/sections/BuildingSection.js';
import { UnitSection } from '../../components/assignment/sections/UnitSection.js';
import { ExternalDevSection } from '../../components/assignment/sections/ExternalDevSection.js';
import { SiteVisitSection } from '../../components/assignment/sections/SiteVisitSection.js';

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

const OCR_LABEL: Record<string, string> = {
  PENDING:      'Pending',
  QUEUED:       'Queued',
  PROCESSING:   'Processing',
  COMPLETED:    'Done',
  FAILED:       'Failed',
  SKIPPED:      'N/A',
  NEEDS_REVIEW: 'Needs Review',
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
  { value: 'INSPECTION_PHOTO',       label: 'Inspection Photo' },
  { value: 'EXTERIOR_PHOTO',         label: 'Exterior Photo' },
  { value: 'SITE_PHOTOGRAPH',        label: 'Site Photograph' },
  { value: 'LOCATION_MAP',           label: 'Location Map' },
  { value: 'OTHER',                  label: 'Other' },
];

const REVIEW_STEPS = ['INTERNAL_REVIEW', 'CLIENT_BANK_REVIEW', 'COMPLIANCE_CHECK', 'APPROVED', 'DELIVERED'];

// ─── Documents Tab ─────────────────────────────────────────
// Human-readable labels for extracted fields shown in the review dialog
const EXTRACTED_LABELS: Array<{ key: keyof ExtractedPropertyData; label: string }> = [
  { key: 'ownerNames',           label: 'Owner Name(s)' },
  { key: 'ownershipNature',      label: 'Ownership Nature' },
  { key: 'ownerShareDetails',    label: 'Share Details' },
  { key: 'developerName',        label: 'Developer / Builder' },
  { key: 'surveyNo',             label: 'Survey No.' },
  { key: 'hissaNo',              label: 'Hissa No.' },
  { key: 'ctsSurveyNo',          label: 'CTS / City Survey No.' },
  { key: 'municipalNo',          label: 'Municipal No.' },
  { key: 'societyName',          label: 'Society Name' },
  { key: 'buildingName',         label: 'Building Name' },
  { key: 'wingName',             label: 'Wing / Tower' },
  { key: 'flatNo',               label: 'Flat / Unit No.' },
  { key: 'floor',                label: 'Floor' },
  { key: 'reraNo',               label: 'RERA No.' },
  { key: 'taluka',               label: 'Taluka' },
  { key: 'village',              label: 'Village / Mouje' },
  { key: 'landmark',             label: 'Landmark' },
  { key: 'municipalCorporation', label: 'Municipal Corporation' },
  { key: 'landAreaSqM',          label: 'Land Area (Sq.M)' },
  { key: 'builtUpAreaSqM',       label: 'Built-up Area (Sq.M)' },
  { key: 'carpetAreaSqM',        label: 'Carpet Area (Sq.M)' },
  { key: 'superBuiltUpAreaSqM',  label: 'Super Built-up Area (Sq.M)' },
  { key: 'unitConfiguration',    label: 'Unit Configuration' },
  { key: 'udsArea',              label: 'UDS Area' },
  { key: 'udsUnit',              label: 'UDS Unit' },
  { key: 'numberOfFloors',       label: 'No. of Floors' },
  { key: 'yearOfConstruction',   label: 'Year of Construction' },
  { key: 'ageOfBuilding',        label: 'Age of Building (yrs)' },
  { key: 'structureType',        label: 'Structure Type' },
  { key: 'zoningClassification', label: 'Zoning Classification' },
  { key: 'dpZone',               label: 'DP Zone' },
  { key: 'naOrderDetails',       label: 'NA Order Details' },
  { key: 'miDcPlotNo',           label: 'MIDC Plot No.' },
  { key: 'approvedPlanAuthority',label: 'Approved Plan Authority' },
  { key: 'approvedPlanDate',     label: 'Approved Plan Date' },
  { key: 'approvedPlanNo',       label: 'Approved Plan No.' },
  { key: 'registrationNo',       label: 'Registration No.' },
  { key: 'registrationDate',     label: 'Registration Date' },
  { key: 'indexIINo',            label: 'Index II No.' },
  { key: 'agreementValue',       label: 'Agreement Value (₹)' },
  { key: 'stampDutyPaid',        label: 'Stamp Duty Paid (₹)' },
  { key: 'occupancyCertificateNo',label: 'OC No.' },
  { key: 'sharesCertificateNo',  label: 'Share Certificate No.' },
];

function DocumentsTab({ assignmentId, canEdit }: { assignmentId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data: docs, isLoading } = useDocuments(assignmentId);
  const { mutate: upload, isPending: uploading } = useUploadDocument();
  const { mutate: deleteDoc } = useDeleteDocument();
  const { mutate: extract, isPending: extracting } = useExtractPropertyData();
  const { mutate: applyData, isPending: applying } = useSavePropertyData();
  const [docType, setDocType] = useState<string>('OTHER');
  const [extractedData, setExtractedData] = useState<ExtractedPropertyData | null>(null);
  const [showReview, setShowReview] = useState(false);

  const ocrReadyCount = (docs ?? []).filter(
    (d) => d.ocrStatus === 'COMPLETED' || d.ocrStatus === 'NEEDS_REVIEW',
  ).length;

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

  function handleExtract() {
    extract(assignmentId, {
      onSuccess: (data) => {
        setExtractedData(data);
        setShowReview(true);
      },
      onError: (err: Error) => {
        toast({ title: 'Extraction failed', description: err.message, variant: 'destructive' });
      },
    });
  }

  function handleApply() {
    if (!extractedData) return;
    // Strip null/undefined — Zod string fields use .optional() (allows undefined) not .nullable()
    // Sending null for string fields causes a ZodError on the backend
    const sanitized = Object.fromEntries(
      Object.entries(extractedData).filter(([, v]) =>
        v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
      ),
    ) as Parameters<typeof applyData>[0]['data'];
    applyData(
      { assignmentId, data: sanitized },
      {
        onSuccess: () => {
          toast({ title: 'Sections pre-populated', description: 'All extracted fields applied. Review each section and save.' });
          setShowReview(false);
        },
        onError: (err: Error) => toast({ title: 'Failed to apply data', description: err.message, variant: 'destructive' }),
      },
    );
  }

  if (isLoading) return <LoadingSpinner />;

  const extractedNonNull = extractedData
    ? EXTRACTED_LABELS.filter(({ key }) => {
        const v = extractedData[key];
        return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
      })
    : [];

  return (
    <div className="space-y-4">
      {/* AI Extraction Banner */}
      {ocrReadyCount > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Bot className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    {ocrReadyCount} document{ocrReadyCount > 1 ? 's' : ''} ready for AI extraction
                  </p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Claude will read OCR text and pre-populate Owner, Location, Area, Building and other sections.
                    You can review and edit before saving.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                disabled={extracting}
                onClick={handleExtract}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Bot className="h-4 w-4 mr-2" />
                {extracting ? 'Extracting…' : 'Extract with AI'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload */}
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

      {/* Document list */}
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
                  <a href={doc.signedUrl ?? '#'} target="_blank" rel="noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1">
                    <FileDown className="h-3 w-3" />{doc.originalName}
                  </a>
                  <span className="text-xs text-muted-foreground">{(doc.fileSizeBytes / 1024).toFixed(0)} KB</span>
                </TableCell>
                <TableCell className="text-sm">{doc.documentType.replace(/_/g, ' ')}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OCR_BADGE[doc.ocrStatus] ?? ''}`}>
                    {OCR_LABEL[doc.ocrStatus] ?? doc.ocrStatus}
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

      {/* Extraction Review Dialog */}
      <Dialog open={showReview} onOpenChange={setShowReview}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              AI Extraction Results
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Claude extracted {extractedNonNull.length} fields from your documents.
              Review below, then click <strong>Apply to Sections</strong> to pre-populate all forms.
              Each section will still need to be individually saved.
            </p>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
            {extractedNonNull.map(({ key, label }) => {
              const v = extractedData?.[key];
              const display = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
              return (
                <div key={key} className="border rounded p-2 bg-muted/30">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium break-words">{display}</p>
                </div>
              );
            })}
            {extractedNonNull.length === 0 && (
              <p className="col-span-2 text-sm text-muted-foreground text-center py-4">
                No fields could be extracted. The documents may not contain readable text yet.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReview(false)}>Cancel</Button>
            <Button
              disabled={applying || extractedNonNull.length === 0}
              onClick={handleApply}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Bot className="h-4 w-4 mr-2" />
              {applying ? 'Applying…' : `Apply ${extractedNonNull.length} Fields to Sections`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ─── Market Comparable Dialog ───────────────────────────────
const EMPTY_COMP: Omit<ComparableSale, 'id'> = {
  address: '', locality: '', transactionDate: '', totalArea: 0, salePrice: 0,
  sourceType: 'MANUAL', sourceUrl: '',
  adjustmentTime: 0, adjustmentLocation: 0,
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
          <div className="col-span-2 space-y-1">
            <Label>Source URL (MKT_006) — IGRS / SRO / listing link</Label>
            <Input value={form.sourceUrl ?? ''} onChange={(e) => setForm((p) => ({ ...p, sourceUrl: e.target.value }))} placeholder="https://igrmaharashtra.gov.in/…" />
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

// ─── Marketability Tab ──────────────────────────────────────
function MarketabilityTab({
  assignmentId, canEdit,
}: {
  assignmentId: string;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const { data: runs, isLoading } = useValuationRuns(assignmentId);
  const { mutate: updateMarket, isPending: saving } = useUpdateMarket();

  const run = runs?.[0];

  const [comparables, setComparables] = useState<Omit<ComparableSale, 'id'>[]>([]);
  const [showCompDialog, setShowCompDialog] = useState(false);
  const [correlatedValue, setCorrelatedValue] = useState('');
  const [analysis, setAnalysis] = useState({
    marketabilityRating: '',
    positiveFactors: '',
    negativeFactors: '',
    marketAnalysisNarrative: '',
  });

  useEffect(() => {
    if (!run) return;
    if (run.comparables?.length) setComparables(run.comparables as Omit<ComparableSale, 'id'>[]);
    if (run.correlatedValue) setCorrelatedValue(String(run.correlatedValue));
    setAnalysis({
      marketabilityRating: run.marketabilityRating ?? '',
      positiveFactors: run.positiveFactors ?? '',
      negativeFactors: run.negativeFactors ?? '',
      marketAnalysisNarrative: run.marketAnalysisNarrative ?? '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  function handleSave() {
    if (!run || comparables.length === 0) {
      toast({ title: 'Add at least one comparable before saving', variant: 'destructive' });
      return;
    }
    const dateFixed = comparables.map(({ sourceUrl, ...c }) => ({
      ...c,
      transactionDate: c.transactionDate.includes('T') ? c.transactionDate : `${c.transactionDate}T00:00:00.000Z`,
      ...(sourceUrl ? { sourceUrl } : {}),
    }));
    updateMarket({ id: run.id, assignmentId, data: {
      comparables: dateFixed,
      correlatedValue: num(correlatedValue) || undefined,
      marketabilityRating: analysis.marketabilityRating || undefined,
      positiveFactors: analysis.positiveFactors || undefined,
      negativeFactors: analysis.negativeFactors || undefined,
      marketAnalysisNarrative: analysis.marketAnalysisNarrative || undefined,
    }}, {
      onSuccess: () => toast({ title: 'Marketability data saved' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed', variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  if (!run) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center">
            Start a valuation run on the <strong>Valuation</strong> tab first, then return here to enter comparable transactions and marketability data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const locked = run.isFinalized;
  const disabled = locked || !canEdit;

  return (
    <div className="space-y-4">
      {/* ── Comparable Transactions (MKT_001–008) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Comparable Transactions</CardTitle>
              <CardDescription className="text-xs">MKT_001–008 · Min. 2–3 comparables required by most banks</CardDescription>
            </div>
            {canEdit && !locked && (
              <Button size="sm" variant="outline" onClick={() => setShowCompDialog(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add Comparable
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {comparables.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No comparable transactions yet. Click <strong>Add Comparable</strong> to begin.
            </p>
          ) : (
            <div className="border rounded text-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Address / Locality</TableHead>
                    <TableHead className="text-right">Area (sq.ft.)</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">Rate/sq.ft.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Source</TableHead>
                    {!locked && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparables.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-xs">{c.address}</div>
                        <div className="text-muted-foreground text-xs">{c.locality}</div>
                      </TableCell>
                      <TableCell className="text-right">{c.totalArea.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right">{fmt(c.salePrice)}</TableCell>
                      <TableCell className="text-right text-primary font-semibold">
                        {c.totalArea > 0 ? `₹${Math.round(c.salePrice / c.totalArea).toLocaleString('en-IN')}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {c.transactionDate ? new Date(c.transactionDate).toLocaleDateString('en-IN') : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{c.sourceType}</div>
                        {c.sourceUrl && (
                          <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs">
                            Source link
                          </a>
                        )}
                      </TableCell>
                      {!locked && (
                        <TableCell>
                          <button onClick={() => setComparables((p) => p.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive">
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

          {/* Correlated / Adopted Value */}
          {run.correlatedValue && (
            <div className="flex items-center gap-2 text-sm pt-1">
              <span className="text-muted-foreground">Auto-correlated Market Value:</span>
              <span className="font-bold text-primary">{fmt(run.correlatedValue)}</span>
            </div>
          )}
          {canEdit && !locked && comparables.length > 0 && (
            <div className="flex items-center gap-3">
              <Label className="text-sm whitespace-nowrap">Adopted Market Value (₹)</Label>
              <Input type="number" className="max-w-[200px]" value={correlatedValue}
                onChange={(e) => setCorrelatedValue(e.target.value)} placeholder="Override if needed" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Marketability Assessment (MKT_009–012) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Marketability Assessment</CardTitle>
          <CardDescription className="text-xs">MKT_009–012 · Required by all bank formats</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Marketability Rating <span className="text-destructive">*</span> (MKT_009)</Label>
              <Select disabled={disabled} value={analysis.marketabilityRating}
                onValueChange={(v) => setAnalysis((p) => ({ ...p, marketabilityRating: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Average">Average</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Factors Favouring Extra Potential Value (MKT_010)</Label>
            <Textarea disabled={disabled} rows={2} value={analysis.positiveFactors}
              onChange={(e) => setAnalysis((p) => ({ ...p, positiveFactors: e.target.value }))}
              placeholder="e.g. Good connectivity, near railway station, high demand area, upcoming metro…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Negative Factors Affecting Market Value (MKT_011)</Label>
            <Textarea disabled={disabled} rows={2} value={analysis.negativeFactors}
              onChange={(e) => setAnalysis((p) => ({ ...p, negativeFactors: e.target.value }))}
              placeholder="e.g. Narrow approach road, flood-prone zone, no RERA registration, ageing structure…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Market Analysis Summary Narrative <span className="text-destructive">*</span> (MKT_012)</Label>
            <Textarea disabled={disabled} rows={4} value={analysis.marketAnalysisNarrative}
              onChange={(e) => setAnalysis((p) => ({ ...p, marketAnalysisNarrative: e.target.value }))}
              placeholder="Describe overall market conditions, demand-supply, recent price trends, micro-market outlook…" />
          </div>
          {canEdit && !locked && (
            <Button disabled={saving || comparables.length === 0} onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />{saving ? 'Saving…' : 'Save Marketability Data'}
            </Button>
          )}
          {locked && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Valuation is finalized — data is locked.
            </p>
          )}
        </CardContent>
      </Card>

      <ComparableDialog open={showCompDialog} onClose={() => setShowCompDialog(false)} onSave={(c) => setComparables((p) => [...p, c])} />
    </div>
  );
}

// ─── Asset type helpers ─────────────────────────────────────
const LAND_TYPES = ['OPEN_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_PLOT', 'INDUSTRIAL_PLOT'];
const LB_TYPES   = ['LAND_AND_BUILDING', 'INDUSTRIAL_FACTORY', 'MIXED_USE'];
const UC_TYPES   = ['UC_FLAT'];

function assetFlags(propertyType: string) {
  const isLand = LAND_TYPES.includes(propertyType);
  const isLB   = LB_TYPES.includes(propertyType);
  const isUC   = UC_TYPES.includes(propertyType);
  const hasLandComponent = isLand || isLB;
  const hasBuilding = !isLand;
  const showLandRate = hasLandComponent;       // VAL_005 mandatory; optional for others
  const showCompositeRate = !isLand && !isLB;  // VAL_006 Flat/Shop/Office/UC
  const showExtDev = isLB;                     // VAL_011 L&B only
  const showDepreciation = hasBuilding && !isUC; // VAL_008
  const showInsurance = !isLand;               // VAL_016
  const showRental = true;                     // VAL_017 all types
  const showBookValue = isLB;                  // VAL_018 L&B only
  return { isLand, isLB, isUC, hasLandComponent, hasBuilding, showLandRate, showCompositeRate, showExtDev, showDepreciation, showInsurance, showRental, showBookValue };
}

// ─── Valuation Tab ─────────────────────────────────────────
function ValuationTab({
  assignmentId, propertyType, canEdit, inspectionComplete, assignmentStatus,
}: {
  assignmentId: string;
  propertyType: string;
  canEdit: boolean;
  inspectionComplete: boolean;
  assignmentStatus: string;
}) {
  const { toast } = useToast();
  const { data: runs, isLoading } = useValuationRuns(assignmentId);
  const { mutate: createRun, isPending: creating } = useCreateValuationRun();
  const { mutate: updateCost, isPending: savingCost } = useUpdateCost();
  const { mutate: updateIncome, isPending: savingIncome } = useUpdateIncome();
  const { mutate: finalize, isPending: finalizing } = useFinalizeValuation();
  const { mutate: requestAI, isPending: aiLoading } = useRequestAIValuation();
  const { mutate: deleteRun, isPending: deletingRun } = useDeleteValuationRun();
  const { data: propertyData } = usePropertyData(assignmentId);

  const flags = assetFlags(propertyType);
  const run = runs?.[0];

  const [cost, setCost] = useState({
    landArea: '', landRatePerSqM: '', landRateSource: 'market',
    buildingPlinthArea: '', buildingRatePerSqM: '',
    ageYears: '', totalLifeYears: '60',
    depreciationMethod: 'STRAIGHT_LINE',
    servicesCostPercent: '5',
    externalDevelopmentValue: '',
    rrRatePerSqM: '', rrRateYear: '',
  });

  const [income, setIncome] = useState({
    grossRent: '', vacancyRate: '5', operatingExpenses: '', capitalizationRate: '8',
  });

  const [weights, setWeights] = useState({ market: '33', cost: '33', income: '34' });
  const [notes, setNotes] = useState('');

  // Bank-specific manual outputs (VAL_016/017/018/006)
  const [outputs, setOutputs] = useState({
    insuranceValue: '', rentalValueMonthly: '', bookValue: '', compositeRatePerSqFt: '',
  });

  useEffect(() => {
    if (!run) return;
    if (run.landRateUsed) setCost((p) => ({ ...p, landRatePerSqM: String(run.landRateUsed ?? '') }));
    if (run.buildingPlinthArea) setCost((p) => ({ ...p, buildingPlinthArea: String(run.buildingPlinthArea ?? '') }));
    if (run.buildingRatePerSqM) setCost((p) => ({ ...p, buildingRatePerSqM: String(run.buildingRatePerSqM ?? '') }));
    if (run.rrRatePerSqM) setCost((p) => ({ ...p, rrRatePerSqM: String(run.rrRatePerSqM ?? '') }));
    if (run.rrRateYear) setCost((p) => ({ ...p, rrRateYear: run.rrRateYear ?? '' }));
    if (run.externalDevelopmentValue) setCost((p) => ({ ...p, externalDevelopmentValue: String(run.externalDevelopmentValue ?? '') }));
    if (run.grossRent) setIncome((p) => ({ ...p, grossRent: String(run.grossRent ?? '') }));
    if (run.capitalizationRate) setIncome((p) => ({ ...p, capitalizationRate: String((run.capitalizationRate ?? 0) * 100) }));
    if (run.reconciliationNotes) setNotes(run.reconciliationNotes);
    if (run.marketApproachWeight) setWeights({ market: String((run.marketApproachWeight ?? 0) * 100), cost: String((run.costApproachWeight ?? 0) * 100), income: String((run.incomeApproachWeight ?? 0) * 100) });
    setOutputs({
      insuranceValue: run.insuranceValue != null ? String(run.insuranceValue) : '',
      rentalValueMonthly: run.rentalValueMonthly != null ? String(run.rentalValueMonthly) : '',
      bookValue: run.bookValue != null ? String(run.bookValue) : '',
      compositeRatePerSqFt: run.compositeRatePerSqFt != null ? String(run.compositeRatePerSqFt) : '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  // Auto-populate cost form fields from property data (fills empty fields only)
  useEffect(() => {
    const p = propertyData?.property;
    if (!p) return;
    const landSqM = p.landAreaActualSqM != null ? parseFloat(String(p.landAreaActualSqM))
      : p.landAreaSqM != null ? parseFloat(String(p.landAreaSqM)) : null;
    const bupSqM = p.builtUpAreaActualSqM != null ? parseFloat(String(p.builtUpAreaActualSqM))
      : p.builtUpAreaSqM != null ? parseFloat(String(p.builtUpAreaSqM)) : null;
    const age = p.ageOfBuilding != null ? String(p.ageOfBuilding) : null;
    setCost((prev) => ({
      ...prev,
      landArea: prev.landArea || (landSqM != null ? String(landSqM) : ''),
      buildingPlinthArea: prev.buildingPlinthArea || (bupSqM != null ? String(bupSqM) : ''),
      ageYears: prev.ageYears || age || '',
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyData?.property?.id]);

  function handleCreate(approach: ValuationApproach) {
    createRun({ assignmentId, approach }, {
      onSuccess: () => toast({ title: 'Valuation run started' }),
      onError: () => toast({ title: 'Failed to create run', variant: 'destructive' }),
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
      rrRatePerSqM: num(cost.rrRatePerSqM) || undefined,
      rrRateYear: cost.rrRateYear || undefined,
      externalDevelopmentValue: num(cost.externalDevelopmentValue) || undefined,
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
      insuranceValue: num(outputs.insuranceValue) || undefined,
      rentalValueMonthly: num(outputs.rentalValueMonthly) || undefined,
      bookValue: num(outputs.bookValue) || undefined,
      compositeRatePerSqFt: num(outputs.compositeRatePerSqFt) || undefined,
    }}, {
      onSuccess: () => toast({ title: 'Valuation finalized!' }),
      onError: (e: unknown) => toast({ title: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Finalization failed', variant: 'destructive' }),
    });
  }

  if (isLoading) return <LoadingSpinner />;

  const PRE_INSPECTION_STATUSES = ['INITIATED', 'ASSIGNED', 'DOCUMENTS_PENDING', 'OCR_COMPLETE', 'DATA_VERIFIED', 'INSPECTION_SCHEDULED'];
  const showInspectionWarning = !inspectionComplete && PRE_INSPECTION_STATUSES.includes(assignmentStatus);

  if (!run) {
    return (
      <div className="space-y-4">
        {showInspectionWarning && (
          <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="ml-6">
              Site inspection has not been submitted yet. You may proceed, but inspection should ideally be completed before finalizing the valuation.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start Valuation</CardTitle>
            <CardDescription>Choose the primary valuation approach</CardDescription>
          </CardHeader>
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
      </div>
    );
  }

  const approach = run.approach;
  const isMarket = approach === 'MARKET_COMPARISON' || approach === 'COMBINED';
  const isCost   = approach === 'COST_APPROACH'   || approach === 'COMBINED';
  const isIncome = approach === 'INCOME_APPROACH'  || approach === 'COMBINED';
  const disabled = run.isFinalized || !canEdit;

  return (
    <div className="space-y-4">
      {showInspectionWarning && (
        <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="ml-6">
            Site inspection has not been submitted yet. You may proceed, but inspection should ideally be completed before finalizing the valuation.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold">{approach.replace(/_/g, ' ')}</span>
          {' '}
          <Badge variant={run.isFinalized ? 'default' : 'secondary'}>
            {run.isFinalized ? '✅ Finalized' : 'In progress'}
          </Badge>
        </div>
        <div className="flex gap-2">
          {canEdit && !run.isFinalized && (
            <Button size="sm" variant="outline" disabled={aiLoading} onClick={() => requestAI({ assignmentId, valuationRunId: run.id }, {
              onSuccess: () => toast({ title: 'AI opinion requested — results saved' }),
              onError: () => toast({ title: 'AI advisory failed', variant: 'destructive' }),
            })}>
              <Bot className="h-4 w-4 mr-1" />{aiLoading ? 'Requesting…' : 'AI Advisory'}
            </Button>
          )}
          {canEdit && !run.isFinalized && (
            <Button size="sm" variant="destructive" disabled={deletingRun}
              onClick={() => { if (confirm('Delete this valuation run and start over with a different approach?')) {
                deleteRun({ id: run.id, assignmentId }, {
                  onSuccess: () => toast({ title: 'Valuation run deleted' }),
                  onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
                });
              }}}>
              {deletingRun ? 'Deleting…' : 'Change Approach'}
            </Button>
          )}
        </div>
      </div>

      {/* ── VAL_002/003/004: Government Rate (all asset types) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Government Ready Reckoner / Jantri Rate</CardTitle>
              <CardDescription className="text-xs">VAL_002–004 · Auto-fetched from state portal or enter manually</CardDescription>
            </div>
            {/* For MARKET_COMPARISON the cost card is hidden, so save RR Rate here */}
            {canEdit && !run.isFinalized && approach === 'MARKET_COMPARISON' && (
              <Button size="sm" disabled={savingCost} onClick={handleSaveCost}>
                <Save className="h-3 w-3 mr-1" />{savingCost ? 'Computing…' : 'Save & Compute'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">RR/Jantri Rate (₹/sq.m.) <span className="text-destructive">*</span></Label>
              <Input type="number" disabled={disabled} value={cost.rrRatePerSqM}
                onChange={(e) => setCost((p) => ({ ...p, rrRatePerSqM: e.target.value }))} placeholder="10000" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate (₹/sq.ft.) — auto</Label>
              <Input type="number" disabled readOnly
                value={cost.rrRatePerSqM ? (num(cost.rrRatePerSqM) / 10.764).toFixed(2) : ''}
                placeholder="929" className="bg-muted/40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reference Year <span className="text-destructive">*</span></Label>
              <Input disabled={disabled} value={cost.rrRateYear}
                onChange={(e) => setCost((p) => ({ ...p, rrRateYear: e.target.value }))} placeholder="2025-26" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Screenshot / Source</Label>
              {run.rrScreenshotUrl
                ? <a href={run.rrScreenshotUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline block pt-2">View screenshot</a>
                : <p className="text-xs text-muted-foreground pt-2">Auto-fetched with scraper</p>}
            </div>
          </div>
          {run.rrRatePerSqM != null && run.govtGuidelineValue != null && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Govt Guideline Value (VAL_015):</span>
              <span className="font-semibold text-primary">{fmt(run.govtGuidelineValue)}</span>
              <span className="text-xs text-muted-foreground">= ₹{Number(run.rrRatePerSqM).toLocaleString('en-IN')}/sq.m. × area</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Market Comparison — read-only summary (data entered on Marketability tab) ── */}
      {isMarket && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Market Comparison</CardTitle>
            <CardDescription className="text-xs">Comparable transactions are entered on the <strong>Marketability</strong> tab</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {run.comparables && (run.comparables as unknown[]).length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {(run.comparables as unknown[]).length} comparable(s) recorded — see Marketability tab for details.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No comparables entered yet. Go to the <strong>Marketability</strong> tab to add them.</p>
            )}
            {run.correlatedValue && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Market Correlated Value:</span>
                <span className="font-bold text-primary">{fmt(run.correlatedValue)}</span>
              </div>
            )}
            {/* VAL_006: Composite Rate for flat/shop/office/UC */}
            {flags.showCompositeRate && (
              <div className="space-y-1 pt-1">
                <Label className="text-xs">Adopted Composite Rate (₹/sq.ft.) — VAL_006</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" disabled={disabled} className="max-w-[180px]"
                    value={outputs.compositeRatePerSqFt}
                    onChange={(e) => setOutputs((p) => ({ ...p, compositeRatePerSqFt: e.target.value }))}
                    placeholder="e.g. 8500" />
                  <span className="text-xs text-muted-foreground">Unit-level rate for report</span>
                </div>
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
              <div>
                <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" />Cost Approach</CardTitle>
                <CardDescription className="text-xs">VAL_007–011</CardDescription>
              </div>
              {canEdit && !run.isFinalized && (
                <Button size="sm" disabled={savingCost} onClick={handleSaveCost}>
                  <Save className="h-3 w-3 mr-1" />{savingCost ? 'Computing…' : 'Save & Compute'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Land sub-section */}
            {flags.hasLandComponent && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Land (VAL_005 / VAL_009)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label className="text-xs">Land Area (sq.m.) <span className="text-destructive">*</span></Label>
                    <Input type="number" disabled={disabled} value={cost.landArea} onChange={(e) => setCost((p) => ({ ...p, landArea: e.target.value }))} placeholder="500" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Adopted Land Rate (₹/sq.m.) <span className="text-destructive">*</span></Label>
                    <Input type="number" disabled={disabled} value={cost.landRatePerSqM} onChange={(e) => setCost((p) => ({ ...p, landRatePerSqM: e.target.value }))} placeholder="15000" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Land Rate Source</Label>
                    <Select disabled={disabled} value={cost.landRateSource} onValueChange={(v) => setCost((p) => ({ ...p, landRateSource: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="govt_rr">Govt. Ready Reckoner</SelectItem>
                        <SelectItem value="market">Market Rate</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
            {/* Land (optional) for flat/shop/office */}
            {!flags.hasLandComponent && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Land (optional)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label className="text-xs">Land Area (sq.m.)</Label>
                    <Input type="number" disabled={disabled} value={cost.landArea} onChange={(e) => setCost((p) => ({ ...p, landArea: e.target.value }))} placeholder="—" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Land Rate (₹/sq.m.)</Label>
                    <Input type="number" disabled={disabled} value={cost.landRatePerSqM} onChange={(e) => setCost((p) => ({ ...p, landRatePerSqM: e.target.value }))} placeholder="—" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Land Rate Source</Label>
                    <Select disabled={disabled} value={cost.landRateSource} onValueChange={(v) => setCost((p) => ({ ...p, landRateSource: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="govt_rr">Govt. Ready Reckoner</SelectItem>
                        <SelectItem value="market">Market Rate</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
            {/* Building sub-section — not for pure land types */}
            {flags.hasBuilding && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Building (VAL_007 / VAL_008 / VAL_010)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label className="text-xs">Building Plinth Area (sq.m.) {flags.isLB && <span className="text-destructive">*</span>}</Label>
                    <Input type="number" disabled={disabled} value={cost.buildingPlinthArea} onChange={(e) => setCost((p) => ({ ...p, buildingPlinthArea: e.target.value }))} placeholder="200" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Construction Rate (₹/sq.m.) {flags.isLB && <span className="text-destructive">*</span>}</Label>
                    <Input type="number" disabled={disabled} value={cost.buildingRatePerSqM} onChange={(e) => setCost((p) => ({ ...p, buildingRatePerSqM: e.target.value }))} placeholder="25000" />
                  </div>
                  {flags.showDepreciation && (
                    <>
                      <div className="space-y-1"><Label className="text-xs">Depreciation Method</Label>
                        <Select disabled={disabled} value={cost.depreciationMethod} onValueChange={(v) => setCost((p) => ({ ...p, depreciationMethod: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="STRAIGHT_LINE">Straight Line</SelectItem>
                            <SelectItem value="WDV">Written Down Value</SelectItem>
                            <SelectItem value="OBSERVED_CONDITION">Observed Condition</SelectItem>
                            <SelectItem value="CPWD_SCHEDULE">CPWD Schedule</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Age of Building (years)</Label>
                        <Input type="number" disabled={disabled} value={cost.ageYears} onChange={(e) => setCost((p) => ({ ...p, ageYears: e.target.value }))} placeholder="15" />
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Total Life (years)</Label>
                        <Input type="number" disabled={disabled} value={cost.totalLifeYears} onChange={(e) => setCost((p) => ({ ...p, totalLifeYears: e.target.value }))} placeholder="60" />
                      </div>
                    </>
                  )}
                  <div className="space-y-1"><Label className="text-xs">Services Cost (%)</Label>
                    <Input type="number" disabled={disabled} value={cost.servicesCostPercent} onChange={(e) => setCost((p) => ({ ...p, servicesCostPercent: e.target.value }))} placeholder="5" />
                  </div>
                </div>
              </div>
            )}
            {/* VAL_011: External Development — L&B only */}
            {flags.showExtDev && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">External Development (VAL_011)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">External Development Value (₹) — compound wall, paving, gate, etc.</Label>
                    <Input type="number" disabled={disabled} value={cost.externalDevelopmentValue}
                      onChange={(e) => setCost((p) => ({ ...p, externalDevelopmentValue: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              </div>
            )}
            {/* Computed outputs */}
            {(run.landValue != null || run.costApproachValue != null) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {run.landValue != null && (
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-xs text-muted-foreground">Land Value (VAL_009)</p>
                    <p className="font-semibold">{fmt(run.landValue)}</p>
                  </div>
                )}
                {run.depreciatedValue != null && (
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-xs text-muted-foreground">Depr. Building Value (VAL_010)</p>
                    <p className="font-semibold">{fmt(run.depreciatedValue)}</p>
                    {run.depreciationRate != null && (
                      <p className="text-xs text-muted-foreground mt-0.5">Dep. {(Number(run.depreciationRate) * 100).toFixed(1)}% (VAL_008)</p>
                    )}
                  </div>
                )}
                {run.externalDevelopmentValue != null && (
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-xs text-muted-foreground">External Dev. (VAL_011)</p>
                    <p className="font-semibold">{fmt(run.externalDevelopmentValue)}</p>
                  </div>
                )}
                {run.costApproachValue != null && (
                  <div className="bg-primary/10 border border-primary/20 rounded p-3">
                    <p className="text-xs text-muted-foreground">Cost Approach Value</p>
                    <p className="font-bold text-primary">{fmt(run.costApproachValue)}</p>
                  </div>
                )}
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
              <div>
                <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Income Approach</CardTitle>
                <CardDescription className="text-xs">VAL_017 · Rental income capitalisation</CardDescription>
              </div>
              {canEdit && !run.isFinalized && (
                <Button size="sm" disabled={savingIncome} onClick={handleSaveIncome}>
                  <Save className="h-3 w-3 mr-1" />{savingIncome ? 'Computing…' : 'Save & Compute'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1"><Label className="text-xs">Monthly Gross Rent (₹) <span className="text-destructive">*</span></Label>
                <Input type="number" disabled={disabled} value={income.grossRent} onChange={(e) => setIncome((p) => ({ ...p, grossRent: e.target.value }))} placeholder="50000" />
              </div>
              <div className="space-y-1"><Label className="text-xs">Vacancy Rate (%)</Label>
                <Input type="number" disabled={disabled} value={income.vacancyRate} onChange={(e) => setIncome((p) => ({ ...p, vacancyRate: e.target.value }))} placeholder="5" />
              </div>
              <div className="space-y-1"><Label className="text-xs">Annual Operating Expenses (₹)</Label>
                <Input type="number" disabled={disabled} value={income.operatingExpenses} onChange={(e) => setIncome((p) => ({ ...p, operatingExpenses: e.target.value }))} placeholder="30000" />
              </div>
              <div className="space-y-1"><Label className="text-xs">Cap Rate (%)</Label>
                <Input type="number" disabled={disabled} value={income.capitalizationRate} onChange={(e) => setIncome((p) => ({ ...p, capitalizationRate: e.target.value }))} placeholder="8" />
              </div>
            </div>
            {run.incomeApproachValue != null && (
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                {run.netOperatingIncome != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Net Operating Income (Annual)</p><p className="font-semibold">{fmt(run.netOperatingIncome)}</p></div>}
                {run.capitalizationRate != null && <div className="bg-muted/50 rounded p-3"><p className="text-xs text-muted-foreground">Cap Rate</p><p className="font-semibold">{(Number(run.capitalizationRate) * 100).toFixed(2)}%</p></div>}
                <div className="bg-primary/10 border border-primary/20 rounded p-3"><p className="text-xs text-muted-foreground">Income Approach Value</p><p className="font-bold text-primary">{fmt(run.incomeApproachValue)}</p></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Additional Outputs (VAL_016/017/018) ── */}
      {canEdit && !run.isFinalized && (flags.showInsurance || flags.showRental || flags.showBookValue || flags.showCompositeRate) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Additional Value Outputs</CardTitle>
            <CardDescription className="text-xs">VAL_016–018 · Bank-specific fields (enter before finalizing)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {flags.showInsurance && (
                <div className="space-y-1">
                  <Label className="text-xs">Insurance / Reinstatement Value (₹) <span className="text-muted-foreground text-xs">(VAL_016)</span></Label>
                  <Input type="number" disabled={disabled} value={outputs.insuranceValue}
                    onChange={(e) => setOutputs((p) => ({ ...p, insuranceValue: e.target.value }))} placeholder="Replacement cost of structure" />
                </div>
              )}
              {flags.showRental && (
                <div className="space-y-1">
                  <Label className="text-xs">Rental Value/Month (₹) <span className="text-muted-foreground text-xs">(VAL_017)</span></Label>
                  <Input type="number" disabled={disabled} value={outputs.rentalValueMonthly}
                    onChange={(e) => setOutputs((p) => ({ ...p, rentalValueMonthly: e.target.value }))} placeholder="Monthly rental estimate" />
                </div>
              )}
              {flags.showBookValue && (
                <div className="space-y-1">
                  <Label className="text-xs">Book Value (₹) <span className="text-muted-foreground text-xs">(VAL_018)</span></Label>
                  <Input type="number" disabled={disabled} value={outputs.bookValue}
                    onChange={(e) => setOutputs((p) => ({ ...p, bookValue: e.target.value }))} placeholder="As per accounts / depreciation schedule" />
                </div>
              )}
              {flags.showCompositeRate && !isMarket && (
                <div className="space-y-1">
                  <Label className="text-xs">Composite Rate (₹/sq.ft.) <span className="text-muted-foreground text-xs">(VAL_006)</span></Label>
                  <Input type="number" disabled={disabled} value={outputs.compositeRatePerSqFt}
                    onChange={(e) => setOutputs((p) => ({ ...p, compositeRatePerSqFt: e.target.value }))} placeholder="e.g. 8500" />
                </div>
              )}
            </div>
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

      {/* ── Final Value Summary (VAL_012–015) ── */}
      {run.roundedValue != null && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Valuation Summary</CardTitle>
              {run.isFinalized && <Lock className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-primary/10 border border-primary/20 rounded p-3 md:col-span-1">
                <p className="text-xs text-muted-foreground">Fair Market Value (VAL_012)</p>
                <p className="text-2xl font-bold text-primary">{fmt(run.roundedValue)}</p>
              </div>
              {run.realizableValue != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Realizable Value — 90% (VAL_013)</p>
                  <p className="font-semibold">{fmt(run.realizableValue)}</p>
                </div>
              )}
              {run.distressValue != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Distress / FSV — 80% (VAL_014)</p>
                  <p className="font-semibold">{fmt(run.distressValue)}</p>
                </div>
              )}
              {run.govtGuidelineValue != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Govt Guideline Value (VAL_015)</p>
                  <p className="font-semibold">{fmt(run.govtGuidelineValue)}</p>
                </div>
              )}
              {run.insuranceValue != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Insurance / Reinstatement (VAL_016)</p>
                  <p className="font-semibold">{fmt(run.insuranceValue)}</p>
                </div>
              )}
              {run.rentalValueMonthly != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Rental Value / Month (VAL_017)</p>
                  <p className="font-semibold">{fmt(run.rentalValueMonthly)}</p>
                </div>
              )}
              {run.bookValue != null && (
                <div className="bg-muted/50 rounded p-3">
                  <p className="text-xs text-muted-foreground">Book Value (VAL_018)</p>
                  <p className="font-semibold">{fmt(run.bookValue)}</p>
                </div>
              )}
            </div>
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
          <CardContent className="space-y-3">
            {(run.aiValuationResult.suggestedLandRateMarket || run.aiValuationResult.suggestedLandRateGovt) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Suggested Land Rates (₹/sq.m.)</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {!!run.aiValuationResult.suggestedLandRateMarket && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Market Rate:</span>
                      <span className="font-semibold">₹{run.aiValuationResult.suggestedLandRateMarket.toLocaleString('en-IN')}</span>
                      {canEdit && !run.isFinalized && (
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                          onClick={() => setCost((p) => ({ ...p, landRatePerSqM: String(run.aiValuationResult!.suggestedLandRateMarket), landRateSource: 'market' }))}>
                          Apply
                        </Button>
                      )}
                    </div>
                  )}
                  {!!run.aiValuationResult.suggestedLandRateGovt && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Govt RR Rate:</span>
                      <span className="font-semibold">₹{run.aiValuationResult.suggestedLandRateGovt.toLocaleString('en-IN')}</span>
                      {canEdit && !run.isFinalized && (
                        <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                          onClick={() => {
                            setCost((p) => ({ ...p, landRatePerSqM: String(run.aiValuationResult!.suggestedLandRateGovt), landRateSource: 'govt_rr', rrRatePerSqM: String(run.aiValuationResult!.suggestedLandRateGovt) }));
                          }}>
                          Apply as RR Rate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {run.aiValuationResult.suggestedValueMid > 0 && (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div><p className="text-xs text-muted-foreground">Low</p><p className="font-semibold">{fmt(run.aiValuationResult.suggestedValueLow)}</p></div>
                <div><p className="text-xs text-muted-foreground">Mid</p><p className="font-bold text-lg">{fmt(run.aiValuationResult.suggestedValueMid)}</p></div>
                <div><p className="text-xs text-muted-foreground">High</p><p className="font-semibold">{fmt(run.aiValuationResult.suggestedValueHigh)}</p></div>
              </div>
            )}
            <Separator />
            {run.aiValuationResult.reasoning && (
              <p className="text-sm whitespace-pre-wrap">
                {run.aiValuationResult.reasoning.replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]{0,20}"suggestedValue[\s\S]*?\}/g, '').trim()}
              </p>
            )}
            {(run.aiValuationResult as unknown as { keyFactors?: string[] }).keyFactors?.length ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Key Factors</p>
                <ul className="text-xs space-y-0.5 list-disc list-inside">
                  {(run.aiValuationResult as unknown as { keyFactors: string[] }).keyFactors.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            ) : null}
            {(run.aiValuationResult as unknown as { caveats?: string[] }).caveats?.length ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Caveats</p>
                <ul className="text-xs space-y-0.5 list-disc list-inside text-muted-foreground">
                  {(run.aiValuationResult as unknown as { caveats: string[] }).caveats.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Confidence: {run.aiValuationResult.confidenceLevel}</p>
          </CardContent>
        </Card>
      )}
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
      onError: (e: unknown) => {
        const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } };
        const msg = err?.response?.data?.error?.message ?? err?.response?.data?.message ?? 'Report generation failed';
        toast({ title: 'Generation failed', description: msg, variant: 'destructive' });
      },
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
  const { mutate: deliver, isPending: delivering } = useDeliverFinalReport();
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [deliverDialog, setDeliverDialog] = useState(false);
  const [deliverEmail, setDeliverEmail] = useState('');
  const [deliverName, setDeliverName] = useState('');
  const [deliverMessage, setDeliverMessage] = useState('');

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
        {isInReview && status !== 'APPROVED' && status !== 'DELIVERED' && canReview && (
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
        {status === 'APPROVED' && canReview && (
          <Button onClick={() => setDeliverDialog(true)}>
            <Send className="h-4 w-4 mr-2" /> Deliver Report
          </Button>
        )}
        {status === 'DELIVERED' && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" /><span className="font-medium">Report delivered</span>
          </div>
        )}
      </div>
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject &amp; Return to Draft</DialogTitle></DialogHeader>
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
      <Dialog open={deliverDialog} onOpenChange={setDeliverDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deliver Approved Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Recipient Name</Label>
              <Input value={deliverName} onChange={(e) => setDeliverName(e.target.value)} placeholder="e.g. Branch Manager" />
            </div>
            <div className="space-y-1">
              <Label>Recipient Email</Label>
              <Input type="email" value={deliverEmail} onChange={(e) => setDeliverEmail(e.target.value)} placeholder="bank@example.com" />
            </div>
            <div className="space-y-1">
              <Label>Message (optional)</Label>
              <Textarea value={deliverMessage} onChange={(e) => setDeliverMessage(e.target.value)} placeholder="Please find the attached valuation report…" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverDialog(false)}>Cancel</Button>
            <Button disabled={!deliverEmail || !deliverName || delivering}
              onClick={() => deliver({ assignmentId, data: { recipientEmail: deliverEmail, recipientName: deliverName, message: deliverMessage || undefined } }, {
                onSuccess: () => { toast({ title: 'Report delivered successfully' }); setDeliverDialog(false); },
                onError: (e: unknown) => toast({ title: (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Delivery failed', variant: 'destructive' }),
              })}>
              {delivering ? 'Delivering…' : 'Send Report'}
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
  const { canEdit, isInspector } = usePermissions();
  const { data: assignment, isLoading, isError } = useAssignment(assignmentId!);
  const { data: reportsData } = useReports(assignmentId!);
  const { data: inspection } = useInspection(assignmentId!);
  const { data: propertyData } = usePropertyData(assignmentId!);

  const tabs = useMemo(() => {
    if (!assignment) return [];
    if (isInspector) return [{ id: 'site-visit', label: TAB_LABELS['site-visit'] }];
    return getTabsForType(String(assignment.propertyType)).map((id) => ({ id, label: TAB_LABELS[id] }));
  }, [assignment?.propertyType, isInspector]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <LoadingSpinner />;
  if (isError || !assignment) return <p className="text-destructive text-sm">Assignment not found.</p>;

  const clientName = assignment.client?.isBank
    ? (assignment.client.bankName ?? assignment.client.companyName)
    : (assignment.client?.companyName ?? assignment.client?.fullName);
  const status = assignment.status as AssignmentStatus;
  const defaultTab = tabs[0]?.id ?? 'general';

  function renderTab(tabId: string) {
    switch (tabId) {
      case 'general':
        return <GeneralSection assignment={assignment!} canEdit={canEdit} />;
      case 'owner':
        return <OwnerSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'documents':
        return <DocumentsTab assignmentId={assignmentId!} canEdit={canEdit} />;
      case 'location':
        return <LocationSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'area':
        return <AreaSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'physical':
        return <PhysicalSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'land':
        return <LandSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'boundary':
        return <BoundarySection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'building':
        return <BuildingSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'unit':
        return <UnitSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'external-dev':
        return <ExternalDevSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} propertyData={propertyData} canEdit={canEdit} />;
      case 'site-visit':
        return <SiteVisitSection assignmentId={assignmentId!} propertyType={String(assignment!.propertyType)} bankName={clientName ?? null} loanType={assignment!.loanType ?? null} canEdit={canEdit} />;
      case 'valuation':
        return (
          <ValuationTab
            assignmentId={assignmentId!}
            propertyType={String(assignment!.propertyType)}
            canEdit={canEdit}
            inspectionComplete={!!inspection?.isComplete}
            assignmentStatus={String(status)}
          />
        );
      case 'marketability':
        return (
          <MarketabilityTab
            assignmentId={assignmentId!}
            canEdit={canEdit}
          />
        );
      case 'report':
        return <ReportsTab assignmentId={assignmentId!} canEdit={canEdit} />;
      case 'annexures':
        return <DocumentsTab assignmentId={assignmentId!} canEdit={canEdit} />;
      default:
        return <ReviewTab assignmentId={assignmentId!} status={status} reports={reportsData ?? []} />;
    }
  }

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate('/assignments')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Assignments
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold font-mono">{assignment.assignmentNo}</h1>
            <StatusBadge status={status} />
            {assignment.finalValue && (
              <span className="text-sm font-medium text-primary">
                {fmt(parseFloat(String(assignment.finalValue)))}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mb-3">
            {clientName ?? '—'} · {String(assignment.propertyType).replace(/_/g, ' ')}
          </p>

          {/* Property address — always visible, especially important for Inspector */}
          {propertyData?.property && (() => {
            const p = propertyData.property;
            const unitLine = [p.flatNo, p.wingName, p.buildingName, p.societyName]
              .filter(Boolean).join(', ');
            const addrLine = [p.addressLine1, p.addressLine2].filter(Boolean).join(', ');
            const cityLine = [p.city, p.district, p.state, p.pincode].filter(Boolean).join(', ');
            return (
              <div className="inline-flex items-start gap-2 bg-muted/50 border rounded-md px-3 py-2 text-sm max-w-xl">
                <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-muted-foreground leading-snug">
                  {unitLine && <span className="font-medium text-foreground">{unitLine}<br /></span>}
                  {addrLine && <span>{addrLine}<br /></span>}
                  {cityLine && <span>{cityLine}</span>}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-6 flex-wrap h-auto gap-1">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs">{tab.label}</TabsTrigger>
          ))}
          {!isInspector && <TabsTrigger value="review" className="text-xs">Review</TabsTrigger>}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            {renderTab(tab.id)}
          </TabsContent>
        ))}

        {!isInspector && (
          <TabsContent value="review">
            <ReviewTab assignmentId={assignmentId!} status={status} reports={reportsData ?? []} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
