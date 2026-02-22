import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAssignments } from '../../api/hooks/useAssignments.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { StatusBadge } from '../../components/shared/StatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import type { AssignmentStatus } from '@valuemitra/shared';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',                   label: 'All Statuses' },
  { value: 'INITIATED',          label: 'Initiated' },
  { value: 'DOCUMENTS_PENDING',  label: 'Docs Pending' },
  { value: 'DOCUMENTS_RECEIVED', label: 'Docs Received' },
  { value: 'OCR_COMPLETE',       label: 'OCR Complete' },
  { value: 'ANALYSIS_IN_PROGRESS', label: 'Analysis' },
  { value: 'REPORT_DRAFT',       label: 'Report Draft' },
  { value: 'INTERNAL_REVIEW',    label: 'Internal Review' },
  { value: 'CLIENT_BANK_REVIEW', label: 'Bank Review' },
  { value: 'APPROVED',           label: 'Approved' },
  { value: 'DELIVERED',          label: 'Delivered' },
];

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const { canCreate } = usePermissions();
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, isError } = useAssignments(
    statusFilter ? { status: statusFilter } : undefined,
  );

  const assignments = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Assignments"
        description="Track all your property valuation assignments."
        action={
          canCreate ? (
            <Button onClick={() => navigate('/assignments/new')}>
              <Plus className="h-4 w-4 mr-2" /> New Assignment
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-4 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value || '_all'}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {data?.pagination?.total ?? 0} total
        </span>
      </div>

      {isLoading && <LoadingSpinner />}
      {isError && <p className="text-destructive text-sm">Failed to load assignments.</p>}

      {!isLoading && !isError && (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignment No.</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Property Type</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Inspection</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No assignments found.{' '}
                    {canCreate && (
                      <button
                        onClick={() => navigate('/assignments/new')}
                        className="text-primary hover:underline"
                      >
                        Create your first one.
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {assignments.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/assignments/${a.id}`)}
                >
                  <TableCell className="font-mono text-sm font-medium">{a.assignmentNo}</TableCell>
                  <TableCell className="text-sm">{a.client.name}</TableCell>
                  <TableCell className="text-sm">{a.propertyType.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-sm">{a.propertyCity ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={a.status as AssignmentStatus} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.inspectionDate
                      ? new Date(a.inspectionDate).toLocaleDateString('en-IN')
                      : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString('en-IN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
