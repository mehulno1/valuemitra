import { Badge } from '../ui/badge.js';
import type { AssignmentStatus } from '@valuemitra/shared';

const STATUS_CONFIG: Record<AssignmentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  INITIATED:            { label: 'Initiated',           variant: 'secondary', className: 'bg-slate-100 text-slate-700' },
  TEMPLATE_SELECTED:    { label: 'Template Selected',   variant: 'secondary', className: 'bg-slate-100 text-slate-700' },
  ASSIGNED:             { label: 'Assigned',            variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
  INSPECTION_SCHEDULED: { label: 'Inspection Scheduled',variant: 'secondary', className: 'bg-blue-100 text-blue-700' },
  INSPECTION_DONE:      { label: 'Inspection Done',     variant: 'secondary', className: 'bg-indigo-100 text-indigo-700' },
  DOCUMENTS_PENDING:    { label: 'Docs Pending',        variant: 'secondary', className: 'bg-yellow-100 text-yellow-700' },
  DOCUMENTS_RECEIVED:   { label: 'Docs Received',       variant: 'secondary', className: 'bg-yellow-100 text-yellow-800' },
  OCR_COMPLETE:         { label: 'OCR Complete',        variant: 'secondary', className: 'bg-purple-100 text-purple-700' },
  ANALYSIS_IN_PROGRESS: { label: 'Analysis',            variant: 'secondary', className: 'bg-purple-100 text-purple-800' },
  REPORT_DRAFT:         { label: 'Report Draft',        variant: 'secondary', className: 'bg-orange-100 text-orange-700' },
  INTERNAL_REVIEW:      { label: 'Internal Review',     variant: 'secondary', className: 'bg-amber-100 text-amber-700' },
  CLIENT_BANK_REVIEW:   { label: 'Bank Review',         variant: 'secondary', className: 'bg-amber-100 text-amber-800' },
  COMPLIANCE_CHECK:     { label: 'Compliance Check',    variant: 'secondary', className: 'bg-amber-100 text-amber-900' },
  APPROVED:             { label: 'Approved',            variant: 'default',   className: 'bg-green-100 text-green-700' },
  DELIVERED:            { label: 'Delivered',           variant: 'default',   className: 'bg-green-600 text-white' },
  ARCHIVED:             { label: 'Archived',            variant: 'outline',   className: 'text-muted-foreground' },
};

interface StatusBadgeProps {
  status: AssignmentStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const, className: '' };
  return (
    <Badge variant={config.variant} className={`${config.className} ${className ?? ''}`}>
      {config.label}
    </Badge>
  );
}
