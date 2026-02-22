import { useAuthStore } from '../../stores/auth.store.js';
import { useAssignments } from '../../api/hooks/useAssignments.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';

const STATUS_COLORS: Record<string, string> = {
  INITIATED: 'bg-gray-100 text-gray-700',
  TEMPLATE_SELECTED: 'bg-blue-50 text-blue-700',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  INSPECTION_SCHEDULED: 'bg-yellow-50 text-yellow-700',
  INSPECTION_DONE: 'bg-yellow-100 text-yellow-800',
  DOCUMENTS_PENDING: 'bg-orange-50 text-orange-700',
  DOCUMENTS_RECEIVED: 'bg-orange-100 text-orange-800',
  OCR_COMPLETE: 'bg-purple-50 text-purple-700',
  ANALYSIS_IN_PROGRESS: 'bg-purple-100 text-purple-800',
  REPORT_DRAFT: 'bg-indigo-50 text-indigo-700',
  INTERNAL_REVIEW: 'bg-indigo-100 text-indigo-800',
  CLIENT_BANK_REVIEW: 'bg-cyan-100 text-cyan-800',
  COMPLIANCE_CHECK: 'bg-teal-100 text-teal-800',
  APPROVED: 'bg-green-100 text-green-700',
  DELIVERED: 'bg-green-200 text-green-800',
  ARCHIVED: 'bg-gray-200 text-gray-600',
};

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const { data, isLoading } = useAssignments({ limit: '5' });

  const total = data?.pagination.total ?? 0;
  const recent = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Welcome, {user?.fullName}
        </h1>
        <p className="text-muted-foreground">{tenant?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{isLoading ? '…' : total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">
              {isLoading ? '…' : recent.filter(a => !['DELIVERED', 'ARCHIVED'].includes(a.status)).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Firm Code</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-mono">{tenant?.firmCode ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent assignments */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">No assignments yet. Create your first one.</p>
          ) : (
            <div className="divide-y">
              {recent.map((a) => (
                <div key={a.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-medium">{a.assignmentNo}</p>
                    <p className="text-sm text-muted-foreground truncate max-w-xs">{a.propertyAddress}</p>
                    <p className="text-xs text-muted-foreground">{a.client.name}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {a.status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
