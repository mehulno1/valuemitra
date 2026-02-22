import { useNavigate } from 'react-router-dom';
import { Plus, Building2, User, Landmark } from 'lucide-react';
import { useClients } from '../../api/hooks/useClients.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import type { ClientType } from '@valuemitra/shared';

const CLIENT_TYPE_CONFIG: Record<ClientType, { label: string; icon: typeof User }> = {
  INDIVIDUAL: { label: 'Individual', icon: User },
  COMPANY:    { label: 'Company',    icon: Building2 },
  BANK:       { label: 'Bank',       icon: Landmark },
  NBFC:       { label: 'NBFC',       icon: Landmark },
  HFC:        { label: 'HFC',        icon: Landmark },
};

function clientDisplayName(client: { clientType: ClientType; fullName?: string; companyName?: string; bankName?: string }) {
  if (client.clientType === 'INDIVIDUAL') return client.fullName ?? '—';
  if (client.clientType === 'BANK' || client.clientType === 'NBFC' || client.clientType === 'HFC')
    return client.bankName ?? client.companyName ?? '—';
  return client.companyName ?? '—';
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const { canCreate } = usePermissions();
  const { data, isLoading, isError } = useClients();

  const clients = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Manage individuals, companies, and banks you work with."
        action={
          canCreate ? (
            <Button onClick={() => navigate('/clients/new')}>
              <Plus className="h-4 w-4 mr-2" /> New Client
            </Button>
          ) : undefined
        }
      />

      {isLoading && <LoadingSpinner />}
      {isError && <p className="text-destructive text-sm">Failed to load clients.</p>}

      {!isLoading && !isError && (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assignments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    No clients yet. {canCreate && 'Create your first client to get started.'}
                  </TableCell>
                </TableRow>
              )}
              {clients.map((client) => {
                const typeConfig = CLIENT_TYPE_CONFIG[client.clientType];
                const Icon = typeConfig.icon;
                return (
                  <TableRow
                    key={client.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {clientDisplayName(client)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeConfig.label}</Badge>
                    </TableCell>
                    <TableCell>{client.city ?? '—'}</TableCell>
                    <TableCell>{client.phone ?? '—'}</TableCell>
                    <TableCell>{client._count?.assignments ?? 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
