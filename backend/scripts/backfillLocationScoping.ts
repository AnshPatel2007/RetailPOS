/**
 * One-off backfill for the multi-store isolation schema change.
 *
 * With one store, every unassigned record goes to it. With several stores,
 * each record goes to the store that used it (see assignByUsage).
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
 *   ... --apply --assign-unused-to="Main Store"  # also assign never-used records
 *
 * Safe to re-run: only ever touches rows still NULL. Point DATABASE_URL at
 * production only after taking a manual snapshot (Render dashboard).
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { planStoreAssignments, StoreUsage } from '../src/utils/storeAssignmentPlan';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
// --assign-unused-to="Store name": records nobody has used yet go to this store.
const UNUSED_TO_NAME = process.argv.find(arg => arg.startsWith('--assign-unused-to='))?.split('=').slice(1).join('=').replace(/^"|"$/g, '').trim() || null;

/**
 * Several stores: each unassigned record goes to the store that actually used
 * it. A category used by several stores is copied so each store gets its own;
 * customers, suppliers and stored-value accounts used by several stores are
 * listed for a person to decide. Unused records are never guessed.
 */
async function assignByUsage(locations: { id: string; name: string }[]) {
  const names = new Map(locations.map(l => [l.id, l.name]));
  const unusedTo = UNUSED_TO_NAME ? locations.find(l => l.name.toLowerCase() === UNUSED_TO_NAME.toLowerCase())?.id : null;
  if (UNUSED_TO_NAME && !unusedTo) throw new Error(`No store named "${UNUSED_TO_NAME}". Stores: ${locations.map(l => l.name).join(', ')}`);
  console.log(`\n=== ${locations.length} stores — assigning unassigned records by where they were used ===`);

  const steps: { label: string; table: string; name: string; splitShared: boolean; usage: Prisma.Sql }[] = [
    { label: 'Category', table: 'categories', name: `name`, splitShared: true,
      usage: Prisma.sql`SELECT "categoryId" AS "recordId", "locationId", count(*)::int AS uses FROM products WHERE "categoryId" IS NOT NULL GROUP BY 1, 2` },
    { label: 'Supplier', table: 'suppliers', name: `name`, splitShared: false,
      usage: Prisma.sql`SELECT ps."supplierId" AS "recordId", p."locationId", count(*)::int AS uses FROM product_suppliers ps JOIN products p ON p.id = ps."productId" GROUP BY 1, 2
        UNION ALL SELECT "supplierId", "locationId", count(*)::int FROM purchase_orders GROUP BY 1, 2` },
    { label: 'PurchaseOrder', table: 'purchase_orders', name: `"orderNumber"`, splitShared: false,
      usage: Prisma.sql`SELECT i."purchaseOrderId" AS "recordId", p."locationId", count(*)::int AS uses FROM purchase_order_items i JOIN products p ON p.id = i."productId" GROUP BY 1, 2` },
    { label: 'Customer', table: 'customers', name: `concat_ws(' ', "firstName", "lastName")`, splitShared: false,
      usage: Prisma.sql`SELECT "customerId" AS "recordId", "locationId", count(*)::int AS uses FROM sales WHERE "customerId" IS NOT NULL GROUP BY 1, 2` },
    { label: 'GiftCard', table: 'gift_cards', name: `code`, splitShared: false,
      usage: Prisma.sql`SELECT t."giftCardId" AS "recordId", s."locationId", count(*)::int AS uses FROM gift_card_transactions t JOIN sales s ON s.id = t."saleId" GROUP BY 1, 2` },
    { label: 'StoreCreditAccount', table: 'store_credit_accounts', name: `id`, splitShared: false,
      usage: Prisma.sql`SELECT t."accountId" AS "recordId", s."locationId", count(*)::int AS uses FROM store_credit_transactions t JOIN sales s ON s.id = t."saleId" GROUP BY 1, 2` },
    { label: 'HouseAccount', table: 'house_accounts', name: `id`, splitShared: false,
      usage: Prisma.sql`SELECT t."accountId" AS "recordId", s."locationId", count(*)::int AS uses FROM house_account_transactions t JOIN sales s ON s.id = t."saleId" GROUP BY 1, 2` },
    { label: 'Exchange', table: 'exchanges', name: `id`, splitShared: false,
      usage: Prisma.sql`SELECT e.id AS "recordId", s."locationId", 1 AS uses FROM exchanges e JOIN sales s ON s.id = e."originalSaleId"` },
  ];

  for (const step of steps) {
    const unassigned = await prisma.$queryRaw<{ id: string; label: string }[]>(Prisma.sql`SELECT id, ${Prisma.raw(step.name)} AS label FROM ${Prisma.raw(`"${step.table}"`)} WHERE "locationId" IS NULL`);
    const labels = new Map(unassigned.map(row => [row.id, `"${row.label}"`]));
    if (!unassigned.length) { console.log(`${step.label}: no unassigned rows.`); continue; }
    const usage = (await prisma.$queryRaw<StoreUsage[]>(step.usage)).map(row => ({ ...row, uses: Number(row.uses) }));
    const plan = planStoreAssignments(unassigned.map(row => row.id), usage, { splitShared: step.splitShared, unusedTo: step.label === 'Exchange' ? null : unusedTo });
    for (const decision of plan) {
      const id = decision.recordId, label = labels.get(id);
      if (decision.action === 'UNUSED') { console.log(`${step.label} ${label}: never used by any store — left unassigned (use --assign-unused-to="Store name")`); continue; }
      if (decision.action === 'AMBIGUOUS') { console.log(`${step.label} ${label}: used by ${decision.locationIds.map(l => names.get(l)).join(' and ')} — left unassigned for review`); continue; }
      console.log(`${step.label} ${label}: ${APPLY ? '' : 'would be '}assigned to ${names.get(decision.locationId)}${decision.action === 'SPLIT' ? `; copied for ${decision.copyTo.map(l => names.get(l)).join(', ')}` : ''}`);
      if (!APPLY) continue;
      await prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${step.table}"`)} SET "locationId" = ${decision.locationId} WHERE id = ${id} AND "locationId" IS NULL`);
        if (decision.action !== 'SPLIT') return;
        const original = await tx.category.findUniqueOrThrow({ where: { id } });
        for (const locationId of decision.copyTo) {
          const copy = await tx.category.create({ data: {
            name: original.name, description: original.description, color: original.color, icon: original.icon,
            sortOrder: original.sortOrder, isActive: original.isActive, locationId,
          } });
          await tx.product.updateMany({ where: { categoryId: id, locationId }, data: { categoryId: copy.id } });
        }
      });
    }
  }
}

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
    await assignByUsage(locations);
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
