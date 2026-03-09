/**
 * One-time script: set bank-conditional flags on all 21 ReportTemplate rows.
 *
 * Run: cd apps/api && npx ts-node --require ./cjs-loader.cjs src/prisma/seed-template-flags.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Fetch all templates
  const templates = await prisma.reportTemplate.findMany({
    select: { id: true, name: true, bankCode: true, propertyType: true, isUnderConstruction: true },
  });

  console.log(`Found ${templates.length} templates`);

  for (const t of templates) {
    const isUC = t.isUnderConstruction;
    const bank = t.bankCode;

    let realizableValuePct = 0.90;
    let showDualStageValuation = false;
    let showInsuranceValue = false;
    let showBookValue = false;
    let showRentalValue = false;
    let showPurchasePrice = false;

    // BOI — 95% realizable, dual-stage UC, purchase price for UC
    if (bank === 'BOI') {
      realizableValuePct = 0.95;
      if (isUC) {
        showDualStageValuation = true;
        showPurchasePrice = true;
      }
    }

    // UBI — 95% realizable, dual-stage UC, purchase price for UC
    if (bank === 'UBI') {
      realizableValuePct = 0.95;
      if (isUC) {
        showDualStageValuation = true;
        showPurchasePrice = true;
        showBookValue = true;  // UBI UC shows book value
      }
    }

    // BOM — insurance value for all, book value for UC
    if (bank === 'BOM') {
      showInsuranceValue = true;
      if (isUC) {
        showBookValue = true;
      }
    }

    // SBI — insurance value + rental value for all types
    if (bank === 'SBI') {
      showInsuranceValue = true;
      showRentalValue = true;
      if (t.propertyType === 'LAND_AND_BUILDING') {
        showBookValue = true;
      }
    }

    // Canara — rental value for all
    if (bank === 'CANARA') {
      showRentalValue = true;
      if (isUC) {
        showBookValue = true;
      }
    }

    await prisma.reportTemplate.update({
      where: { id: t.id },
      data: {
        realizableValuePct: String(realizableValuePct),
        showDualStageValuation,
        showInsuranceValue,
        showBookValue,
        showRentalValue,
        showPurchasePrice,
      },
    });

    console.log(`✅ ${t.name} — pct=${realizableValuePct}, dual=${showDualStageValuation}, ins=${showInsuranceValue}, book=${showBookValue}, rent=${showRentalValue}, pp=${showPurchasePrice}`);
  }

  console.log('\nDone.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
