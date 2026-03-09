/**
 * Seed script: Pre-populate all 8 banks as BANK-type clients for every tenant.
 *
 * Idempotent — skips any bank that already exists for a tenant (checked by bankCode).
 *
 * Run:
 *   cd apps/api && npx ts-node --require ./cjs-loader.cjs src/prisma/seed-bank-clients.ts
 *
 * Also called programmatically by tenants.service when a new tenant registers.
 */

import { prisma } from '../config/database.js';

export const BANK_CLIENTS = [
  { bankCode: 'BOB',    bankName: 'Bank of Baroda' },
  { bankCode: 'BOI',    bankName: 'Bank of India' },
  { bankCode: 'BOM',    bankName: 'Bank of Maharashtra' },
  { bankCode: 'CANARA', bankName: 'Canara Bank' },
  { bankCode: 'PNB',    bankName: 'Punjab National Bank' },
  { bankCode: 'SBI',    bankName: 'State Bank of India' },
  { bankCode: 'NKGSB',  bankName: 'NKGSB Cooperative Bank' },
  { bankCode: 'UBI',    bankName: 'Union Bank of India' },
] as const;

/**
 * Creates all 8 bank clients for a given tenant. Skips any that already exist.
 * Safe to call multiple times — fully idempotent.
 */
export async function seedBankClientsForTenant(tenantId: string): Promise<void> {
  for (const bank of BANK_CLIENTS) {
    const existing = await prisma.client.findFirst({
      where: { tenantId, bankCode: bank.bankCode },
    });
    if (existing) continue;

    await prisma.client.create({
      data: {
        tenantId,
        clientType: 'BANK',
        isBank: true,
        bankCode: bank.bankCode,
        bankName: bank.bankName,
      },
    });
  }
}

// ─── Script entrypoint (run directly) ────────────────────────────────────────

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log(`Found ${tenants.length} tenant(s)\n`);

  for (const tenant of tenants) {
    console.log(`Tenant: ${tenant.name} (${tenant.id})`);
    for (const bank of BANK_CLIENTS) {
      const existing = await prisma.client.findFirst({
        where: { tenantId: tenant.id, bankCode: bank.bankCode },
      });
      if (existing) {
        console.log(`  [SKIP]    ${bank.bankName} — already exists`);
      } else {
        await prisma.client.create({
          data: {
            tenantId: tenant.id,
            clientType: 'BANK',
            isBank: true,
            bankCode: bank.bankCode,
            bankName: bank.bankName,
          },
        });
        console.log(`  [CREATED] ${bank.bankName}`);
      }
    }
  }

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
