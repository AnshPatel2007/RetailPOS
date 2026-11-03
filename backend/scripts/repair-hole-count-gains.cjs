// One-off repair for corrections recorded before the negative-balance fix.
//
// Before the fix, a count or manual gain that brought a negative balance back up
// was booked as an inventory gain, cancelling the cost of the sales that caused
// the shortfall (e.g. Coffee sold at -1, counted to 0: COGS -$6, a false 100%
// margin). This posts one current-period COST_CORRECTION per affected entry that
// reverses only the shortfall portion of that gain. Original entries stay
// immutable. Dry run by default; pass --apply to write.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient, Prisma } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.inventoryValueEntry.findMany({
    where: { quantityBefore: { lt: 0 }, quantity: { gt: 0 }, cogsAmount: { lt: 0 }, valueBefore: { not: null },
      kind: { in: ['COUNT', 'CYCLE_COUNT', 'ADJUSTMENT', 'IMPORT'] } },
    orderBy: { sequence: 'asc' },
  });
  let total = new Prisma.Decimal(0), repaired = 0;
  for (const entry of candidates) {
    const sourceKey = 'repair-hole-gain:' + entry.id;
    if (await prisma.inventoryValueEntry.findUnique({ where: { sourceKey } })) continue;
    const filled = Math.min(entry.quantity, -entry.quantityBefore);
    const unit = entry.valueBefore.div(entry.quantityBefore); // positive provisional unit cost
    const holeGain = unit.mul(filled).toDecimalPlaces(8);
    const reversal = Prisma.Decimal.min(holeGain, entry.cogsAmount.negated());
    if (reversal.lessThanOrEqualTo(0)) continue;
    const product = await prisma.product.findUnique({ where: { id: entry.productId }, select: { name: true } });
    console.log(`${apply ? 'Repair' : 'Would repair'}: ${product?.name ?? entry.productId} — ${entry.kind} on ${entry.createdAt.toISOString().slice(0, 10)}`
      + ` filled ${filled} unit(s); reverse $${reversal.toFixed(2)} of wrongly booked gain`);
    total = total.plus(reversal); repaired++;
    if (!apply) continue;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${entry.productId} FOR UPDATE`;
      const balance = await tx.inventoryValuation.findUniqueOrThrow({ where: { productId: entry.productId } });
      await tx.inventoryValueEntry.create({ data: {
        productId: entry.productId, locationId: entry.locationId, userId: entry.userId, kind: 'COST_CORRECTION', mode: 'CORRECTION',
        sourceId: entry.id, sourceKey, quantity: 0, quantityBefore: balance.quantity, quantityAfter: balance.quantity,
        valueBefore: balance.value, valueChange: 0, valueAfter: balance.value, cogsAmount: reversal, costStatus: 'ESTIMATED',
        referenceEntryId: entry.id,
        notes: 'Repair: a correction that filled a negative balance had cancelled the sale cost; that portion is reinstated.',
      } });
    });
  }
  console.log(`${repaired} entr${repaired === 1 ? 'y' : 'ies'} ${apply ? 'repaired' : 'to repair'}; cost of goods ${apply ? 'increased' : 'would increase'} by $${total.toFixed(2)}.`);
  if (!apply && repaired) console.log('Run again with --apply to write the corrections.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
