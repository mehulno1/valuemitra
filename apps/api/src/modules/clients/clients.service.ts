import { prisma } from '../../config/database.js';
import { NotFoundError, ConflictError } from '../../middleware/error.middleware.js';
import { createAuditLog } from '../../middleware/audit.middleware.js';
import { ClientType, BankCode } from '@valuemitra/shared';

export interface CreateClientInput {
  clientType: ClientType;
  fullName?: string;      // INDIVIDUAL clients
  companyName?: string;   // COMPANY / NBFC / HFC clients
  bankName?: string;      // BANK clients
  pan?: string;
  gstin?: string;
  cin?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isBank?: boolean;
  bankCode?: BankCode;
  bankBranch?: string;
  ifscCode?: string;
  loanAccountNo?: string;
}

// ─────────────────────────────────────────────
// Helper: best displayable name for a client
// ─────────────────────────────────────────────

function clientDisplayName(c: {
  fullName: string | null;
  companyName: string | null;
  bankName: string | null;
}): string {
  return c.bankName ?? c.companyName ?? c.fullName ?? '—';
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export async function listClients(tenantId: string, search?: string) {
  const clients = await prisma.client.findMany({
    where: {
      tenantId,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { companyName: { contains: search } },
              { bankName: { contains: search } },
              { loanAccountNo: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return clients.map(c => ({ ...c, displayName: clientDisplayName(c) }));
}

export async function getClient(tenantId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId } });
  if (!client) throw new NotFoundError('Client not found');
  return { ...client, displayName: clientDisplayName(client) };
}

export async function createClient(
  tenantId: string,
  actorId: string,
  input: CreateClientInput,
) {
  if (input.loanAccountNo) {
    const existing = await prisma.client.findFirst({
      where: { tenantId, loanAccountNo: input.loanAccountNo },
    });
    if (existing) throw new ConflictError('A client with this loan account number already exists');
  }

  const client = await prisma.client.create({
    data: {
      tenantId,
      clientType: input.clientType,
      fullName: input.fullName,
      companyName: input.companyName,
      bankName: input.bankName,
      pan: input.pan,
      gstin: input.gstin,
      cin: input.cin,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      isBank: input.isBank ?? false,
      bankCode: input.bankCode,
      bankBranch: input.bankBranch,
      ifscCode: input.ifscCode,
      loanAccountNo: input.loanAccountNo,
    },
  });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'client.created',
    entityType: 'Client',
    entityId: client.id,
    after: { displayName: clientDisplayName(client), clientType: client.clientType },
  });

  return { ...client, displayName: clientDisplayName(client) };
}

export async function updateClient(
  tenantId: string,
  actorId: string,
  clientId: string,
  data: Partial<CreateClientInput>,
) {
  const existing = await prisma.client.findFirst({ where: { id: clientId, tenantId } });
  if (!existing) throw new NotFoundError('Client not found');

  const updated = await prisma.client.update({ where: { id: clientId }, data });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'client.updated',
    entityType: 'Client',
    entityId: clientId,
    before: existing as Record<string, unknown>,
    after: updated as Record<string, unknown>,
  });

  return { ...updated, displayName: clientDisplayName(updated) };
}

export async function deleteClient(tenantId: string, actorId: string, clientId: string) {
  const existing = await prisma.client.findFirst({ where: { id: clientId, tenantId } });
  if (!existing) throw new NotFoundError('Client not found');

  await prisma.client.delete({ where: { id: clientId } });

  await createAuditLog({
    tenantId,
    userId: actorId,
    action: 'client.deleted',
    entityType: 'Client',
    entityId: clientId,
    before: { displayName: clientDisplayName(existing), clientType: existing.clientType },
  });
}
