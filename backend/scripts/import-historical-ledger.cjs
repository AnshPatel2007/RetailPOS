'use strict';
// Deliberately no checkout, tender-provider, inventory, or notification calls.
// Caller supplies verified store identities; source profit figures are never read.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { reportCalendar } = require('../src/services/reportDates.service');
const hash = value => createHash('sha256').update(value).digest('hex');
const id = key => 'historical-' + hash(key).slice(0, 32);
const amount = cents => { assert(Number.isSafeInteger(cents) && cents >= 0); return (cents / 100).toFixed(2); };

function buildPlan(staged, stores) {
  assert.match(staged.sha256, /^[a-f0-9]{64}$/);
  assert.equal(staged.amountUnit, 'integer cents');
  const plan = { sales: [], expenses: [], income: [], months: [] };
  const keys = new Set();
  for (const block of staged.blocks) {
    const store = stores[block.store];
    assert(store?.id && store?.userId && store?.timezone, 'Unmapped store: ' + block.store);
    const cal = reportCalendar(store.timezone);
    const [year, month] = block.period.split('-').map(Number);
    const recognizedAt = cal.midnight(year, month + 1, 0);
    const prefix = `ledger-v1:${store.id}:${block.period}`;
    const notes = `${block.sourceTitle}. Monthly summary; recognized at month end. Actual transaction and payment dates were not supplied. Source ${staged.sha256}.`;
    const sums = { collected: 0, tax: 0, card: 0, expenses: 0, otherIncome: 0, lotteryNet: 0 };
    for (const day of block.days) {
      assert(day.date.startsWith(block.period + '-'));
      const key = `ledger-v1:${store.id}:${day.date}`;
      assert(!keys.has(key), 'Duplicate source day'); keys.add(key);
      const v = day.valuesCents;
      for (const value of Object.values(v)) assert(value === null || Number.isSafeInteger(value));
      assert(v.totalCollected !== null && v.card !== null);
      assert.equal(v.totalCollected, (v.register1 || 0) + (v.register2 || 0) + v.card);
      const tax = (v.tax1 || 0) + (v.tax2 || 0);
      const [y, m, d] = day.date.split('-').map(Number);
      assert.equal(new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10), day.date);
      const createdAt = cal.midnight(y, m, d);
      const caveats = ['Receipt counts, discounts, item costs and non-card tender details were not supplied.'];
      if (block.issues.length) caveats.push('January source tax summary includes an unexplained $500 not present in daily entries; it is excluded pending clarification.');
      const sourceData = { businessDate: day.date, register1Cents: v.register1, register2Cents: v.register2,
        tax1Cents: v.tax1, tax2Cents: v.tax2, cardCents: v.card, lotteryNetCents: v.lottery,
        sourceTitle: block.sourceTitle, sourceHash: staged.sha256, sourceLine: day.sourceLine, caveats };
      plan.sales.push({ id: id(key), saleNumber: `HIST-${store.code}-${day.date.replaceAll('-', '')}`,
        idempotencyKey: id(key), locationId: store.id, userId: store.userId,
        sourceType: 'DAILY_SUMMARY', sourceData, pricingVersion: 0, status: 'COMPLETED',
        subtotal: amount(v.totalCollected - tax), tax: amount(tax), total: amount(v.totalCollected),
        amountPaid: amount(v.totalCollected), paymentMethod: 'OTHER', createdAt, completedAt: createdAt,
        notes: 'Historical daily summary. Date represents the business day, not a checkout time. No item, inventory or drawer posting.',
        payments: { create: [
          { paymentMethod: 'CARD', amount: amount(v.card), reference: 'Historical card total; no payment processed', createdAt },
          { paymentMethod: 'OTHER', amount: amount(v.totalCollected - v.card), reference: 'Historical remainder; tender type not supplied', createdAt },
        ].filter(p => Number(p.amount) > 0) },
      });
      sums.collected += v.totalCollected; sums.tax += tax; sums.card += v.card; sums.lotteryNet += v.lottery || 0;
    }
    assert.equal(sums.collected, block.calculatedCents.totalCollected);
    assert.equal(sums.tax, block.calculatedCents.tax);
    const expense = (suffix, cents, label) => {
      assert(cents !== null, 'Missing monthly expense total');
      if (!cents) return;
      plan.expenses.push({ id: id(prefix + ':expense:' + suffix), expenseNumber: `HIST-${store.code}-${block.period}-${suffix}`,
        locationId: store.id, userId: store.userId, category: 'OTHER', sourceType: 'MONTHLY_SUMMARY', status: 'APPROVED',
        amount: amount(cents), expenseDate: recognizedAt, description: `${label}. ${notes}` });
      sums.expenses += cents;
    };
    expense('monthly', block.sourceMonthlyInputsCents.expenses, 'Monthly operating expenses (source total; categories not supplied)');
    // These separately listed costs are below the monthly subtotal in Nelson January.
    if (block.store === 'Nelson Food & Liquor' && block.period === '2026-01') {
      for (const [label, cents, suffix] of [
        ['Old Owner Cigarate Liance Fee', 450000, 'licence'],
        ['Billding Maintance Front Door, Lighte & Painting', 300000, 'maintenance'],
        ['Waking Cooler Fixed', 350000, 'cooler'],
      ]) {
        const source = block.sidebar.find(row => row.cells[0] === label);
        assert(source && Math.round(Number(source.cells[2]) * 100) === cents, 'Missing separate January expense evidence');
        expense(suffix, cents, 'Additional source expense: ' + label);
      }
    }
    for (const [field, kind] of [['gamingAtm', 'GAMING_ATM'], ['lotteryCommission', 'LOTTERY_COMMISSION']]) {
      const cents = block.sourceMonthlyInputsCents[field];
      if (cents === null || cents === undefined || cents === 0) continue;
      const sourceKey = prefix + ':' + kind;
      plan.income.push({ id: id(sourceKey), sourceKey, locationId: store.id, period: block.period, kind,
        amount: amount(cents), recognizedAt, notes });
      sums.otherIncome += cents;
    }
    plan.months.push({ store: block.store, locationId: store.id, period: block.period, days: block.days.length,
      range: { gte: cal.midnight(year, month, 1), lt: cal.midnight(year, month + 1, 1) }, cents: sums });
  }
  return plan;
}

async function applyPlan(db, plan) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(20261022, 1)");
    const result = { sales: 0, expenses: 0, income: 0, existing: 0 };
    for (const [group, model] of [['sales', 'sale'], ['expenses', 'expense'], ['income', 'historicalIncome']]) {
      for (const data of plan[group]) {
        const existing = await tx[model].findUnique({ where: { id: data.id }, ...(group === 'sales' ? { include: { payments: true, items: true } } : {}) });
        if (existing) {
          // A retry must neither duplicate nor silently overwrite edited records.
          for (const [key, expected] of Object.entries(data)) {
            if (key === 'payments') {
              const tenders = rows => rows.map(p => `${p.paymentMethod}:${Number(p.amount).toFixed(2)}`).sort();
              assert.deepEqual(tenders(existing.payments), tenders(expected.create));
              assert.equal(existing.items.length, 0);
            } else if (key === 'sourceData') assert.deepEqual(existing[key], expected);
            else if (expected instanceof Date) assert.equal(existing[key]?.toISOString(), expected.toISOString(), key);
            else if (['subtotal', 'tax', 'total', 'amountPaid', 'amount'].includes(key)) assert.equal(Number(existing[key]).toFixed(2), expected, key);
            else assert.equal(existing[key], expected, key);
          }
          result.existing++; continue;
        }
        await tx[model].create({ data }); result[group]++;
      }
    }
    return result;
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}
module.exports = { buildPlan, applyPlan };
