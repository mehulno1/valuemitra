import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, Hash } from 'lucide-react';
import { useClient } from '../../api/hooks/useClients.js';
import { useAssignments } from '../../api/hooks/useAssignments.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { StatusBadge } from '../../components/shared/StatusBadge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import type { AssignmentStatus } from '@valuemitra/shared';

function InfoRow({ label, value }: { label: string; value?: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { canCreate } = usePermissions();

  const { data: client, isLoading, isError } = useClient(clientId!);
  const { data: assignmentsData } = useAssignments({ clientId });

  const assignments = assignmentsData?.data ?? [];

  const displayName =
    client?.clientType === 'INDIVIDUAL'
      ? client?.fullName
      : client?.clientType === 'BANK' || client?.clientType === 'NBFC' || client?.clientType === 'HFC'
        ? client?.bankName ?? client?.companyName
        : client?.companyName;

  if (isLoading) return <LoadingSpinner />;
  if (isError || !client) return <p className="text-destructive text-sm">Client not found.</p>;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate('/clients')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Clients
      </Button>

      <PageHeader
        title={displayName ?? 'Client'}
        description={client.clientType.replace('_', ' ')}
        action={
          canCreate ? (
            <Button onClick={() => navigate(`/assignments/new?clientId=${client.id}`)}>
              New Assignment
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Client Info */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Badge variant="outline">{client.clientType}</Badge>
            {client.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${client.email}`} className="text-primary hover:underline">{client.email}</a>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {client.phone}
              </div>
            )}
            {(client.city || client.state) && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {[client.city, client.state].filter(Boolean).join(', ')}
              </div>
            )}
            {client.pan && (
              <div className="flex items-center gap-2 text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                PAN: {client.pan}
              </div>
            )}
            <InfoRow label="GSTIN" value={client.gstin} />
            <InfoRow label="Bank Branch" value={client.bankBranch} />
            <InfoRow label="IFSC" value={client.ifscCode} />
          </CardContent>
        </Card>

        {/* Assignments */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Assignments ({assignments.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignment No.</TableHead>
                  <TableHead>Property Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">
                      No assignments yet.
                    </TableCell>
                  </TableRow>
                )}
                {assignments.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/assignments/${a.id}`)}
                  >
                    <TableCell className="font-mono text-sm">{a.assignmentNo}</TableCell>
                    <TableCell className="text-sm">{a.propertyType.replace(/_/g, ' ')}</TableCell>
                    <TableCell><StatusBadge status={a.status as AssignmentStatus} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString('en-IN')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
