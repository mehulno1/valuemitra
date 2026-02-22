import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, Upload, Trash2, Bot, Lock, Send, CheckCircle2, XCircle } from 'lucide-react';
import { useAssignment } from '../../api/hooks/useAssignments.js';
import { useDocuments, useUploadDocument, useDeleteDocument } from '../../api/hooks/useDocuments.js';
import { useValuationRuns, useCreateValuationRun, useFinalizeValuation, useRequestAIValuation } from '../../api/hooks/useValuation.js';
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
import { Label } from '../../components/ui/label.js';
import { Separator } from '../../components/ui/separator.js';
import { useToast } from '../../hooks/use-toast.js';
import type { AssignmentStatus, DocumentType, ValuationApproach } from '@valuemitra/shared';

// ─── helpers ────────────────────────────────────────────────
function fmt(n?: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

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

const REVIEW_STEPS = [
  'INTERNAL_REVIEW', 'CLIENT_BANK_REVIEW', 'COMPLIANCE_CHECK', 'APPROVED', 'DELIVERED',
];

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
              <Label
                htmlFor="doc-upload"
                className="cursor-pointer"
              >
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
                  <a
                    href={doc.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <FileDown className="h-3 w-3" />
                    {doc.fileName}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {(doc.fileSize / 1024).toFixed(0)} KB
                  </span>
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
                    <button
                      onClick={() =>
                        deleteDoc(
                          { id: doc.id, assignmentId },
                          { onSuccess: () => toast({ title: 'Deleted' }), onError: () => toast({ title: 'Delete failed', variant: 'destructive' }) },
                        )
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
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

// ─── Valuation Tab ─────────────────────────────────────────
function ValuationTab({ assignmentId, canEdit }: { assignmentId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data: runs, isLoading } = useValuationRuns(assignmentId);
  const { mutate: createRun, isPending: creating } = useCreateValuationRun();
  const { mutate: finalize, isPending: finalizing } = useFinalizeValuation();
  const { mutate: requestAI, isPending: aiLoading } = useRequestAIValuation();

  const run = runs?.[0];

  function handleCreate(approach: ValuationApproach) {
    createRun(
      { assignmentId, approach },
      {
        onSuccess: () => toast({ title: 'Valuation run started' }),
        onError: () => toast({ title: 'Failed', variant: 'destructive' }),
      },
    );
  }

  function handleFinalize() {
    if (!run) return;
    finalize(
      { id: run.id, assignmentId, data: { marketWeight: 33, costWeight: 33, incomeWeight: 34 } },
      {
        onSuccess: () => toast({ title: 'Valuation finalized!' }),
        onError: () => toast({ title: 'Finalization failed', variant: 'destructive' }),
      },
    );
  }

  if (isLoading) return <LoadingSpinner />;

  if (!run) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <p className="text-muted-foreground text-sm">No valuation run started yet.</p>
          {canEdit && (
            <div className="flex gap-2 justify-center flex-wrap">
              {(['MARKET_COMPARISON', 'COST_APPROACH', 'INCOME_APPROACH', 'COMBINED'] as ValuationApproach[]).map((a) => (
                <Button key={a} variant="outline" size="sm" disabled={creating} onClick={() => handleCreate(a)}>
                  {a.replace(/_/g, ' ')}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{run.approach.replace(/_/g, ' ')}</h3>
          <p className="text-xs text-muted-foreground">
            {run.isFinalized ? '✅ Finalized' : 'In progress'}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && !run.isFinalized && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={aiLoading}
                onClick={() => requestAI(assignmentId, {
                  onSuccess: () => toast({ title: 'AI opinion requested' }),
                  onError: () => toast({ title: 'AI failed', variant: 'destructive' }),
                })}
              >
                <Bot className="h-4 w-4 mr-1" /> AI Advisory
              </Button>
              <Button size="sm" disabled={finalizing} onClick={handleFinalize}>
                <Lock className="h-4 w-4 mr-1" /> Finalize
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Market Value</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{fmt(run.costValue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Cost Approach</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{fmt(run.costValue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Income Approach</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{fmt(run.incomeValue)}</p></CardContent>
        </Card>
      </div>

      {run.finalValue && (
        <Card className="border-primary">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Final Weighted Value</p>
              <p className="text-3xl font-bold text-primary">{fmt(run.finalValue)}</p>
            </div>
            {run.isFinalized && <Lock className="h-6 w-6 text-muted-foreground" />}
          </CardContent>
        </Card>
      )}

      {run.aiValuationResult && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Bot className="h-4 w-4" /> AI Advisory Opinion
            </CardTitle>
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
    generate(
      { assignmentId, templateId: selectedTemplate },
      {
        onSuccess: () => toast({ title: 'Report generated' }),
        onError: () => toast({ title: 'Generation failed', variant: 'destructive' }),
      },
    );
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <Label>Select Template</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger><SelectValue placeholder="Choose a report template" /></SelectTrigger>
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
              <TableHead>Status</TableHead>
              <TableHead>Generated</TableHead>
              <TableHead>Downloads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(reports ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                  No reports generated yet.
                </TableCell>
              </TableRow>
            )}
            {(reports ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">{r.template?.name ?? '—'}</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.generatedAt ? new Date(r.generatedAt).toLocaleDateString('en-IN') : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {r.pdfSignedUrl && (
                      <a href={r.pdfSignedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">PDF</a>
                    )}
                    {r.docxSignedUrl && (
                      <a href={r.docxSignedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">DOCX</a>
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
function ReviewTab({
  assignmentId,
  status,
  reports,
}: { assignmentId: string; status: AssignmentStatus; reports: { id: string }[] }) {
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
    if (!firstReport) {
      toast({ title: 'Generate a report first', variant: 'destructive' });
      return;
    }
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
                  done   ? 'bg-green-500 border-green-500 text-white' :
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

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {status === 'REPORT_DRAFT' && canEdit && (
          <Button disabled={submitting || !firstReport} onClick={handleSubmit}>
            <Send className="h-4 w-4 mr-2" />
            {submitting ? 'Submitting…' : 'Submit for Internal Review'}
          </Button>
        )}

        {isInReview && status !== 'DELIVERED' && canReview && (
          <>
            <Button
              disabled={advancing}
              onClick={() => advance({ assignmentId }, {
                onSuccess: () => toast({ title: 'Review advanced' }),
                onError: () => toast({ title: 'Failed', variant: 'destructive' }),
              })}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {advancing ? 'Advancing…' : 'Advance'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRejectDialog(true)}
            >
              <XCircle className="h-4 w-4 mr-2" /> Reject
            </Button>
          </>
        )}

        {status === 'DELIVERED' && (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Report delivered</span>
          </div>
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject & Return to Draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (required, min 10 characters)</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why the report is being returned…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.length < 10 || rejecting}
              onClick={() =>
                reject({ assignmentId, data: { reason: rejectReason } }, {
                  onSuccess: () => { toast({ title: 'Rejected — back to draft' }); setRejectDialog(false); },
                  onError: () => toast({ title: 'Reject failed', variant: 'destructive' }),
                })
              }
            >
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
            {assignment.client.name} · {assignment.propertyType?.replace(/_/g, ' ')} · {assignment.propertyCity}
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

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Property</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Address: </span>{prop?.addressLine1 ?? assignment.propertyAddress}</div>
                <div><span className="text-muted-foreground">City: </span>{prop?.city ?? assignment.propertyCity}</div>
                <div><span className="text-muted-foreground">State: </span>{prop?.state}</div>
                {prop?.landAreaSqM && <div><span className="text-muted-foreground">Land Area: </span>{prop.landAreaSqM} sqm</div>}
                {prop?.builtUpAreaSqM && <div><span className="text-muted-foreground">Built-up: </span>{prop.builtUpAreaSqM} sqm</div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Assignment Info</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Client: </span>{assignment.client.name}</div>
                <div><span className="text-muted-foreground">Purpose: </span>{(assignment as unknown as { purposeOfValuation?: string }).purposeOfValuation?.replace(/_/g, ' ')}</div>
                <div><span className="text-muted-foreground">Inspection: </span>{assignment.inspectionDate ? new Date(assignment.inspectionDate).toLocaleDateString('en-IN') : '—'}</div>
                {(assignment as unknown as { finalValue?: number }).finalValue && (
                  <div><span className="text-muted-foreground">Final Value: </span><span className="font-bold text-primary">{fmt((assignment as unknown as { finalValue?: number }).finalValue)}</span></div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <DocumentsTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        {/* Valuation */}
        <TabsContent value="valuation">
          <ValuationTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        {/* Reports */}
        <TabsContent value="reports">
          <ReportsTab assignmentId={assignmentId!} canEdit={canEdit} />
        </TabsContent>

        {/* Review */}
        <TabsContent value="review">
          <ReviewTab
            assignmentId={assignmentId!}
            status={status}
            reports={reportsData ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
