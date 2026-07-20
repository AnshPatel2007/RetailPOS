/**
 * One-off backfill for the multi-store isolation schema change.
 *
 * Run manually (ts-node, not part of the app runtime) AFTER pushing the new
 * nullable `locationId` columns (Customer, GiftCard, StoreCreditAccount,
 * HouseAccount, Supplier, PurchaseOrder, Category, Exchange) and BEFORE
 * pushing the Product `sku`/`barcode` composite-unique constraint change.
 *
 * Usage:
 *   cd backend
 *   npx ts-node scripts/backfillLocationScoping.ts           # dry run (default)
 *   npx ts-node scripts/backfillLocationScoping.ts --apply    # actually write changes
 *
 * Safe to re-run: only ever touches rows still NULL. Point DATABASE_URL at
 * production only after taking a manual snapshot (Render dashboard).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function checkProductDuplicates(): Promise<boolean> {
  console.log('\n=== Product (sku, locationId) duplicate check ===');
  const dupes = await prisma.$queryRaw<{ sku: string; locationId: string | null; count: bigint }[]>`
    SELECT sku, "locationId", count(*) as count
    FROM products
    GROUP BY sku, "locationId"
    HAVING count(*) > 1
  `;
  if (dupes.length === 0) {
    console.log('OK — no duplicate (sku, locationId) pairs. Safe to push the composite-unique constraint.');
    return true;
  }
  console.log(`FOUND ${dupes.length} duplicate (sku, locationId) pair(s) — must be resolved manually before pushing the composite-unique constraint:`);
  for (const d of dupes) {
    console.log(`  sku=${d.sku} locationId=${d.locationId ?? 'NULL'} count=${d.count}`);
  }
  return false;
}

async function main() {
  console.log(`Backfill run — mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no writes)'}`);

  await checkProductDuplicates();

  const locations = await prisma.location.findMany({ select: { id: true, name: true } });
  console.log(`\n=== Locations found: ${locations.length} ===`);
  locations.forEach((l) => console.log(`  ${l.id} — ${l.name}`));

  const tables: {
    label: string;
    countNull: () => Promise<number>;
    backfillToSingleLocation: (locationId: string) => Promise<number>;
  }[] = [
    {
      label: 'Customer',
      countNull: () => prisma.customer.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.customer.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'GiftCard',
      countNull: () => prisma.giftCard.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.giftCard.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'StoreCreditAccount',
      countNull: () => prisma.storeCreditAccount.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.storeCreditAccount.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'HouseAccount',
      countNull: () => prisma.houseAccount.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.houseAccount.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'Supplier',
      countNull: () => prisma.supplier.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.supplier.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'PurchaseOrder',
      countNull: () => prisma.purchaseOrder.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.purchaseOrder.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'Category',
      countNull: () => prisma.category.count({ where: { locationId: null } }),
      backfillToSingleLocation: async (locationId) =>
        (await prisma.category.updateMany({ where: { locationId: null }, data: { locationId } })).count,
    },
    {
      label: 'Exchange',
      countNull: () => prisma.exchange.count({ where: { locationId: null } }),
      // Exchange should inherit its location from the original sale, not just
      // blanket-assign to "the" location — handled separately below.
      backfillToSingleLocation: async () => 0,
    },
  ];

  console.log(`\n=== Per-table NULL locationId counts ===`);
  for (const t of tables) {
    const nullCount = await t.countNull();
    console.log(nullCount === 0 ? `${t.label}: no NULL rows.` : `${t.label}: ${nullCount} row(s) with NULL locationId.`);
  }

  if (locations.length === 1) {
    const [only] = locations;
    console.log(`\n=== Exactly one location exists (${only.name}) — backfilling all NULLs to it ===`);
    for (const t of tables) {
      if (t.label === 'Exchange') continue; // handled below
      const nullCount = await t.countNull();
      if (nullCount === 0) continue;
      if (APPLY) {
        const updated = await t.backfillToSingleLocation(only.id);
        console.log(`${t.label}: updated ${updated} row(s) -> locationId=${only.id}`);
      } else {
        console.log(`${t.label}: would update ${nullCount} row(s) -> locationId=${only.id} (dry run, use --apply)`);
      }
    }

    // Exchange: backfill from the original sale's location (may still leave
    // some NULL if the original sale itself has no locationId)
    const exchangesNull = await prisma.exchange.findMany({
      where: { locationId: null },
      select: { id: true, originalSaleId: true },
    });
    if (exchangesNull.length > 0) {
      console.log(`Exchange: ${exchangesNull.length} row(s) with NULL locationId — resolving via original sale...`);
      let updated = 0;
      let leftNull = 0;
      for (const ex of exchangesNull) {
        const sale = await prisma.sale.findUnique({ where: { id: ex.originalSaleId }, select: { locationId: true } });
        if (sale?.locationId) {
          if (APPLY) {
            await prisma.exchange.update({ where: { id: ex.id }, data: { locationId: sale.locationId } });
          }
          updated++;
        } else {
          leftNull++;
        }
      }
      console.log(`Exchange: ${APPLY ? 'updated' : 'would update'} ${updated} row(s) from their sale's location, ${leftNull} left NULL (ambiguous).`);
    } else {
      console.log('Exchange: no NULL rows.');
    }
  } else if (locations.length > 1) {
    console.log(
      `\n=== ${locations.length} locations exist — NOT auto-backfilling. ` +
        `Review the per-table NULL counts above and assign records to a store manually ` +
        `(e.g. via each entity's edit UI, once available) before relying on per-store isolation ` +
        `for pre-existing data. Records left NULL are treated as chain-wide/shared, matching the ` +
        'Promotion model\'s existing null-semantics — not an error, just "undecided". ===\n'
    );
  } else {
    console.log('\nNo locations exist yet — nothing to backfill.');
  }

  console.log(`\nDone. ${APPLY ? '' : 'This was a DRY RUN — re-run with --apply to write changes.'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
