#!/usr/bin/env node
/** Isolated, repeatable PostgreSQL fixture and measured service acceptance. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
require('dotenv').config({ path: path.join(backend, '.env') });
process.env.TS_NODE_PROJECT = path.join(backend, 'tsconfig.json');
require('ts-node/register/transpile-only');
const { assertDisposableDatabase } = require('../backend/src/utils/testDatabase');
const { PrismaClient } = require('@prisma/client');
const operational = process.env.DATABASE_URL;
const command = process.argv[2] || 'help';
const markerVersion = 'pos-performance-v2';
const round = value => Math.round(value * 100) / 100;
const targets = { dashboard: 1500, inventory: 2500, anomalies: 2500, forecast: 1500, financial: 1000, reportFirst: 1500, reportDeep: 1500 };
const workloads = Object.keys(targets);
function sourceFingerprint() {
  const files = ['scripts/pos-performance.cjs', 'backend/prisma/schema.prisma',
    'backend/src/services/dashboardReport.service.ts', 'backend/src/services/inventoryAnalytics.service.ts',
    'backend/src/services/salesForecast.service.ts', 'backend/src/services/financialMetrics.service.ts',
    'backend/src/services/salesReport.service.ts', 'backend/src/services/salesCollectionMetrics.service.ts', 'backend/src/services/reportDates.service.ts'];
  return Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

function safeTarget() {
  if (!operational) throw new Error('Set the operational DATABASE_URL in backend/.env; it is used only to derive a separate target.');
  const target = new URL(process.env.DATABASE_URL_BENCHMARK || operational);
  if (!process.env.DATABASE_URL_BENCHMARK) target.pathname += '_performance_v2_benchmark';
  assertDisposableDatabase(target.toString(), operational);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname)) throw new Error('Benchmarks require a localhost PostgreSQL target.');
  const allowedParameters = new Set(['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'sslmode', 'sslaccept', 'application_name', 'statement_cache_size', 'pgbouncer']);
  if ((target.searchParams.get('schema') || 'public') !== 'public' || target.searchParams.getAll('schema').length > 1 || [...target.searchParams.keys()].some(key => !allowedParameters.has(key))) {
    throw new Error('Benchmarks require the public schema and standard connection parameters without host/startup-option overrides.');
  }
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+_benchmark$/.test(name) || Buffer.byteLength(name) > 63) throw new Error('Use a database name ending _benchmark, at most 63 bytes.');
  // Avoid aliases bypassing the operational comparison in the shared guard.
  const source = new URL(operational);
  if (decodeURIComponent(source.pathname.slice(1)) === name) {
    throw new Error('Benchmark and operational databases identify the same local database.');
  }
  target.searchParams.set('connection_limit', '5');
  return { url: target.toString(), name };
}
const connect = url => new PrismaClient({ datasources: { db: { url } }, log: [] });
const safeError = error => String(error.message || error).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]');

async function metadata(db) {
  const found = await db.$queryRaw`SELECT to_regclass('public.pos_benchmark_meta') IS NOT NULL AS present`;
  if (!found[0].present) return null;
  const rows = await db.$queryRaw`SELECT value FROM pos_benchmark_meta WHERE key = 'fixture'`;
  return rows[0]?.value || null;
}
async function counts(db) {
  const [row] = await db.$queryRaw`SELECT (SELECT COUNT(*)::int FROM sales) AS sales,
    (SELECT COUNT(*)::int FROM sale_items) AS items, (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT COUNT(*)::int FROM customers) AS customers, (SELECT COUNT(*)::int FROM refunds) AS refunds,
    (SELECT COUNT(*)::int FROM refund_items) AS "refundItems", (SELECT COUNT(*)::int FROM sale_voids) AS voids,
    (SELECT COUNT(*)::int FROM locations) AS stores`;
  return row;
}
async function requireFixture(db) {
  const info = await metadata(db);
  if (!info || info.version !== markerVersion || info.status !== 'COMPLETE') throw new Error('Run prepare against a new empty _benchmark database first; an incomplete/unowned fixture is never reset automatically.');
  const actual = await counts(db);
  if (actual.sales !== 100000 || actual.items !== 200000 || actual.products !== 10000 || actual.customers !== 2000 || actual.stores !== 2) throw new Error('Fixture row counts changed; choose a new empty benchmark database.');
  const scopeCounts = await db.$queryRaw`SELECT s."locationId", COUNT(*)::int AS sales,
    COUNT(r.id)::int AS refunds, COUNT(v.id)::int AS voids FROM sales s
    LEFT JOIN refunds r ON r."saleId"=s.id LEFT JOIN sale_voids v ON v."saleId"=s.id GROUP BY s."locationId" ORDER BY s."locationId"`;
  if (scopeCounts.length !== 2 || scopeCounts.some(row => !row.refunds || !row.voids)) throw new Error('Both synthetic stores must exercise refunds and voids.');
  const [integrity] = await db.$queryRaw`WITH lines AS (
    SELECT "saleId",SUM(total) AS total,SUM(tax) AS tax,SUM("unitCost"*quantity) AS cost FROM sale_items GROUP BY "saleId"
  ) SELECT (SELECT COUNT(*)::int FROM sales s JOIN lines i ON i."saleId"=s.id WHERE s.total<>i.total OR s.tax<>i.tax) AS "imbalancedSales",
    (SELECT COUNT(*)::int FROM sale_items WHERE "unitCost" IS NULL OR "taxRate" IS NULL OR "taxTreatment" IS NULL) AS "missingLineFacts",
    (SELECT COUNT(*)::int FROM sale_voids v JOIN lines i ON i."saleId"=v."saleId" WHERE v.amount<>i.total OR v."taxAmount"<>i.tax OR v."costReversed"<>i.cost) AS "imbalancedVoids",
    (SELECT COUNT(*)::int FROM refunds r WHERE r.tenders IS NULL OR r."taxAmount" IS NULL OR NOT EXISTS(SELECT 1 FROM refund_items ri WHERE ri."refundId"=r.id AND ri."costReturned" IS NOT NULL)) AS "incompleteReturns",
    (SELECT COUNT(*)::int FROM refunds r WHERE r.amount<>(SELECT SUM(ri.amount) FROM refund_items ri WHERE ri."refundId"=r.id)
      OR r."taxAmount"<>(SELECT SUM(ri."taxAmount") FROM refund_items ri WHERE ri."refundId"=r.id)
      OR r.amount<>(SELECT SUM((part->>'amount')::numeric) FROM JSONB_ARRAY_ELEMENTS(r.tenders) part)) AS "imbalancedReturns",
    (SELECT COUNT(*)::int FROM sale_items i JOIN sales s ON s.id=i."saleId" JOIN products p ON p.id=i."productId" WHERE p."locationId"<>s."locationId") AS "crossStoreItems"`;
  if (Object.values(integrity).some(value => value !== 0)) throw new Error('Fixture financial snapshots are incomplete or imbalanced.');
  return { ...info, counts: actual, scopeCounts, integrity };
}

function deployReviewedMigrations(target) {
  // Keep the shared development migration schema and Prisma client untouched.
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-benchmark-migrations-'));
  try {
    fs.copyFileSync(path.join(backend, 'prisma/schema.prisma'), path.join(migrationDir, 'schema.prisma'));
    fs.cpSync(path.join(backend, 'prisma/reconciled/migrations'), path.join(migrationDir, 'migrations'), { recursive: true });
    const applied = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(migrationDir, 'schema.prisma')],
      { cwd: backend, env: { ...process.env, DATABASE_URL: target.url }, encoding: 'utf8', windowsHide: true });
    if (applied.status !== 0) throw new Error(`Reviewed migration deployment failed: ${applied.stderr || applied.stdout}`);
  } finally {
    const resolvedTemp = path.resolve(migrationDir), resolvedParent = path.resolve(os.tmpdir());
    if (path.dirname(resolvedTemp) !== resolvedParent || !path.basename(resolvedTemp).startsWith('pos-benchmark-migrations-')) throw new Error('Unexpected temporary migration path');
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

async function prepare(target) {
  const adminUrl = new URL(target.url); adminUrl.pathname = '/postgres';
  const admin = connect(adminUrl.toString());
  try {
    const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${target.name}`;
    if (!exists.length) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${target.name}"`);
      console.log(`Created isolated database ${target.name}.`);
    }
  } finally { await admin.$disconnect(); }
  const db = connect(target.url);
  try {
    const prior = await metadata(db);
    if (prior) {
      if (prior.version !== markerVersion || prior.status !== 'COMPLETE') throw new Error('This benchmark fixture has another version or is incomplete; choose a fresh _benchmark database.');
      deployReviewedMigrations(target);
      const info = await requireFixture(db);
      console.log(`Existing complete fixture retained: ${JSON.stringify(info.counts)}.`);
      return;
    }
    // Do not deploy migrations over, clear, or adopt somebody else's database.
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    for (const { tablename } of tables) {
      if (tablename === '_prisma_migrations') continue;
      const [row] = await db.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM "${tablename.replace(/"/g, '""')}" LIMIT 1) AS populated`);
      if (row.populated) throw new Error('The benchmark database contains unowned data. Choose a new empty _benchmark name; nothing was deleted.');
    }
    deployReviewedMigrations(target);
    const asOf = new Date().toISOString();
    console.log('Seeding 100,000 sales, 200,000 line snapshots, 10,000 products and 2,000 customers across two stores.');
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TABLE pos_benchmark_meta (key text PRIMARY KEY, value jsonb NOT NULL)');
      await tx.$executeRawUnsafe(`INSERT INTO locations (id,name,address,city,state,"zipCode",phone,email,timezone,"taxRate","updatedAt")
        VALUES ('bench-store-1','Benchmark Tobacco Liquor Grocery','Synthetic','Chicago','IL','60000','000','store1@example.test','America/Chicago',8.25,NOW()),
          ('bench-store-2','Benchmark Isolation Store','Synthetic','Los Angeles','CA','90000','000','store2@example.test','America/Los_Angeles',8.25,NOW())`);
      await tx.$executeRawUnsafe(`INSERT INTO users (id,email,password,"firstName","lastName",role,"locationId","updatedAt")
        SELECT 'bench-user-'||i,'benchmark'||i||'@example.test','!NO_LOGIN!','Synthetic','Owner','ADMIN','bench-store-'||i,NOW() FROM generate_series(1,2) i`);
      await tx.$executeRawUnsafe(`INSERT INTO categories (id,name,"locationId","updatedAt") SELECT 'bench-category-'||i,
        (ARRAY['Grocery','Liquor','Tobacco','Household','Cold drinks'])[1+(i-1)%5], 'bench-store-'||CASE WHEN i<=5 THEN 1 ELSE 2 END,NOW() FROM generate_series(1,10) i`);
      await tx.$executeRawUnsafe(`INSERT INTO customers (id,email,"firstName","lastName","locationId","createdAt","updatedAt")
        SELECT 'bench-customer-'||i,'customer'||i||'@example.test','Synthetic','Customer '||i,
          'bench-store-'||CASE WHEN i<=1800 THEN 1 ELSE 2 END, NOW()-INTERVAL '180 days',NOW() FROM generate_series(1,2000) i`);
      await tx.$executeRawUnsafe(`INSERT INTO products (id,sku,name,"categoryId",price,cost,"stockQuantity","lowStockAlert","locationId","minimumAge","ebtEligible","createdAt","updatedAt")
        SELECT 'bench-product-'||i,'BENCH-'||i,'Synthetic Product '||i,
          'bench-category-'||(1+(i-1)%5+CASE WHEN i<=9000 THEN 0 ELSE 5 END),
          5+(i%1700)/100.0,2+(i%1000)/100.0,CASE WHEN i%30=0 THEN 0 ELSE i%300 END,10,
          'bench-store-'||CASE WHEN i<=9000 THEN 1 ELSE 2 END,CASE WHEN i%5 IN(1,2) THEN 21 ELSE NULL END,i%5=0,NOW()-INTERVAL '190 days',NOW() FROM generate_series(1,10000) i`);
      await tx.$executeRawUnsafe(`INSERT INTO suppliers (id,name,"locationId","leadTimeDays","updatedAt") VALUES
        ('bench-supplier-1','Synthetic Supplier 1','bench-store-1',3,NOW()),('bench-supplier-2','Synthetic Supplier 2','bench-store-2',5,NOW())`);
      await tx.$executeRawUnsafe(`INSERT INTO product_suppliers (id,"productId","supplierId","leadTime","minOrder",cost,"updatedAt")
        SELECT 'bench-link-'||i,'bench-product-'||i,'bench-supplier-'||CASE WHEN i<=9000 THEN 1 ELSE 2 END,
          CASE WHEN i%15=0 THEN NULL ELSE 3+(i%3) END,6,2+(i%1000)/100.0,NOW() FROM generate_series(1,10000) i`);
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE benchmark_facts ON COMMIT DROP AS
        SELECT i,j,'bench-store-'||CASE WHEN i%10=0 THEN 2 ELSE 1 END AS store,
          'bench-product-'||(CASE WHEN i%10=0 THEN 9001+((i/10+j*17)%1000) ELSE 1+((i+j*17)%9000) END) AS product,
          1+CASE WHEN i%3=0 THEN 1 ELSE 0 END AS quantity,
          (500+(i%1700)+j*100)/100.0 AS price,
          (200+(i%1000)+j*50)/100.0 AS cost,
          $1::timestamptz AT TIME ZONE 'UTC' - INTERVAL '1 hour' - ((i-1)%4320)*INTERVAL '1 hour' + ((i-1)%3600)*INTERVAL '1 second' AS at
        FROM generate_series(1,100000) i CROSS JOIN generate_series(1,2) j`, asOf);
      await tx.$executeRawUnsafe(`INSERT INTO sales (id,"saleNumber","userId","locationId","customerId",subtotal,tax,total,"paymentMethod","amountPaid",status,"pricingVersion","pointsEarned","pointsRedeemed","loyaltyDiscount","createdAt","completedAt","updatedAt")
        SELECT 'bench-sale-'||i,'BENCH-'||LPAD(i::text,6,'0'),'bench-user-'||CASE WHEN i%10=0 THEN 2 ELSE 1 END,store,
          'bench-customer-'||CASE WHEN i%10=0 THEN 1801+((i/10)%200) ELSE 1+(i%1800) END,
          SUM(price*quantity),SUM(ROUND(price*quantity*0.0825,2)),SUM(price*quantity+ROUND(price*quantity*0.0825,2)),
          (CASE WHEN i%2=0 THEN 'CARD' ELSE 'CASH' END)::"PaymentMethod",SUM(price*quantity+ROUND(price*quantity*0.0825,2)),
          (CASE WHEN at < $1::timestamptz AT TIME ZONE 'UTC'-INTERVAL '3 days' AND i%25=0 THEN 'VOIDED'
            WHEN at < $1::timestamptz AT TIME ZONE 'UTC'-INTERVAL '3 days' AND i%23=0 THEN 'REFUNDED' ELSE 'COMPLETED' END)::"SaleStatus",
          1,0,0,0,at,at,at FROM benchmark_facts GROUP BY i,store,at`, asOf);
      await tx.$executeRawUnsafe(`INSERT INTO sale_items (id,"saleId","productId",sku,"productName",quantity,price,tax,total,"unitCost","taxRate","taxTreatment","manualDiscount","loyaltyDiscount",surcharge,"pointsEarned","pointsRedeemed","createdAt","updatedAt")
        SELECT 'bench-item-'||f.i||'-'||f.j,'bench-sale-'||f.i,f.product,p.sku,p.name,f.quantity,f.price,ROUND(f.price*f.quantity*0.0825,2),
          f.price*f.quantity+ROUND(f.price*f.quantity*0.0825,2),f.cost,8.25,'TAXABLE',0,0,0,0,0,f.at,f.at FROM benchmark_facts f JOIN products p ON p.id=f.product`);
      await tx.$executeRawUnsafe(`INSERT INTO sale_payments (id,"saleId","paymentMethod",amount,"createdAt") SELECT 'bench-payment-'||id,id,"paymentMethod",total,"createdAt" FROM sales`);
      await tx.$executeRawUnsafe(`INSERT INTO refunds (id,"saleId",amount,"taxAmount",reason,"refundedBy",method,tenders,"pointsRestored","pointsReversed","createdAt")
        SELECT 'bench-refund-'||s.id,s.id,i.total,i.tax,'Synthetic returned item',s."userId",s."paymentMethod"::text,
          JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('sourcePaymentId','bench-payment-'||s.id,'originalMethod',s."paymentMethod"::text,'method',s."paymentMethod"::text,'amount',i.total,'reference','BENCH-REFUND-'||s.id)),
          0,0,s."createdAt"+INTERVAL '2 days 1 hour'
        FROM sales s JOIN sale_items i ON i.id='bench-item-'||REPLACE(s.id,'bench-sale-','')||'-1' WHERE s.status='REFUNDED'`);
      await tx.$executeRawUnsafe(`INSERT INTO refund_items (id,"refundId","saleItemId",quantity,amount,"taxAmount","costReturned",restocked,"pointsRestored","pointsReversed","createdAt")
        SELECT 'bench-refund-item-'||r.id,r.id,i.id,i.quantity,i.total,i.tax,i."unitCost"*i.quantity,true,0,0,r."createdAt"
        FROM refunds r JOIN sale_items i ON i.id='bench-item-'||REPLACE(r."saleId",'bench-sale-','')||'-1'`);
      await tx.$executeRawUnsafe(`INSERT INTO sale_voids (id,"saleId","locationId","userId",reason,amount,"taxAmount",discount,"costReversed","pointsRestored","pointsReversed",items,tenders,"requestHash","createdAt")
        SELECT 'bench-void-'||s.id,s.id,s."locationId",s."userId",'Synthetic dated void',s.total,s.tax,0,SUM(i."unitCost"*i.quantity),0,0,
          JSONB_AGG(JSONB_BUILD_OBJECT('saleItemId',i.id,'productId',i."productId",'productName',i."productName",'sku',i.sku,'quantity',i.quantity,'amount',i.total,'taxAmount',i.tax,'costReversed',i."unitCost"*i.quantity)),
          JSONB_BUILD_OBJECT(s."paymentMethod"::text,s.total),REPEAT('b',64),s."createdAt"+INTERVAL '2 days 1 hour'
        FROM sales s JOIN sale_items i ON i."saleId"=s.id WHERE s.status='VOIDED' GROUP BY s.id`);
      // Cached customer facts are derived from the same synthetic original sales;
      // they are not used as a substitute for the immutable financial snapshots.
      await tx.$executeRawUnsafe(`UPDATE customers c SET "visitCount"=facts.visits,"totalSpent"=facts.total,"lastVisitAt"=facts.last_at FROM
        (SELECT "customerId",COUNT(*)::int AS visits,SUM(total) AS total,MAX("createdAt") AS last_at FROM sales GROUP BY "customerId") facts WHERE c.id=facts."customerId"`);
      const info = { version: markerVersion, status: 'COMPLETE', asOf, seed: 'deterministic-sql-v2', stores: ['bench-store-1', 'bench-store-2'] };
      await tx.$executeRawUnsafe('INSERT INTO pos_benchmark_meta(key,value) VALUES ($1,$2::jsonb)', 'fixture', JSON.stringify(info));
    }, { timeout: 180000, maxWait: 10000 });
    await db.$executeRawUnsafe('ANALYZE');
    console.log(`Fixture ready: ${JSON.stringify((await requireFixture(db)).counts)}.`);
  } finally { await db.$disconnect(); }
}

function sqlLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `ARRAY[${value.map(sqlLiteral).join(',')}]`;
  return "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replace(/'/g, "''") + "'";
}
async function worker(target, workload) {
  if (!workloads.includes(workload)) throw new Error('Unknown benchmark workload');
  const samples = Number(process.env.POS_BENCHMARK_SAMPLES || '10');
  if (!Number.isInteger(samples) || samples < 5 || samples > 100) throw new Error('POS_BENCHMARK_SAMPLES must be an integer from 5 to 100');
  const db = new PrismaClient({ datasources: { db: { url: target.url } }, log: [{ emit: 'event', level: 'query' }] });
  const events = [];
  let transactionPlanMode = 'auto', transactionWorkMem = null;
  db.$on('query', event => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(event.query)) { transactionPlanMode = 'auto'; transactionWorkMem = null; }
    if (/^\s*SET LOCAL plan_cache_mode\s*=\s*force_custom_plan/i.test(event.query)) transactionPlanMode = 'force_custom_plan';
    const workMem = /^\s*SET LOCAL work_mem\s*=\s*'(\d+(?:kB|MB|GB))'/i.exec(event.query);
    if (workMem) transactionWorkMem = workMem[1];
    if (/^\s*(SELECT|WITH)/i.test(event.query)) events.push({ query: event.query, params: event.params, durationMs: event.duration, observedPlanMode: transactionPlanMode, observedWorkMem: transactionWorkMem });
  });
  // Inject the instrumented, dedicated client before loading application code.
  const dbModule = require.resolve('../backend/src/config/database');
  require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: { __esModule: true, default: db, resolveDatabaseUrl: () => target.url } };
  try {
    const info = await requireFixture(db);
    await db.$disconnect(); // First workload call includes a new connection pool.
    const now = new Date(info.asOf), scope = { locationId: 'bench-store-1' };
    const calendar = require('../backend/src/services/reportDates.service').reportCalendar('America/Chicago', now);
    const req = page => ({ user: { id: 'bench-user-1', role: 'ADMIN', locationId: scope.locationId }, query: { page: String(page), limit: '50', startDate: calendar.day(-179).toISOString(), endDate: now.toISOString() } });
    let operation;
    if (workload === 'dashboard') operation = () => require('../backend/src/services/dashboardReport.service').getDashboardReportData(scope, now);
    if (workload === 'inventory') operation = () => require('../backend/src/services/inventoryAnalytics.service').inventoryPredictions(scope, 1, now);
    if (workload === 'anomalies') operation = () => require('../backend/src/services/inventoryAnalytics.service').salesAnomalies(scope, now);
    if (workload === 'forecast') operation = () => require('../backend/src/services/salesForecast.service').getSalesForecastData(scope, 30, now);
    if (workload === 'financial') operation = () => require('../backend/src/services/financialMetrics.service').getFinancialMetrics(scope, { gte: calendar.day(-29), lte: now });
    if (workload.startsWith('report')) operation = () => require('../backend/src/services/salesReport.service').getSalesReportData(req(workload === 'reportFirst' ? 1 : 900));
    const measure = async () => {
      const before = performance.now();
      const result = await operation();
      // Count serialization cost as service payload generation, matching JSON APIs.
      const serialized = JSON.stringify(result);
      if (workload.startsWith('report') && (!result.pagination || result.sales.length > 50)) throw new Error('Sales reports must implement fixed50 server pagination before benchmark acceptance.');
      return { ms: performance.now() - before, bytes: Buffer.byteLength(serialized), result };
    };
    events.length = 0;
    const cold = await measure();
    await measure(); await measure();
    const measurements = [];
    for (let index = 0; index < samples; index++) measurements.push(await measure());
    const sorted = measurements.map(row => row.ms).sort((a, b) => a - b);
    const percentile = p => round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]);
    // Explain the five slowest unique statements observed, using fixture-only
    // literal parameters. Read-only transactions prevent accidental mutations.
    const bySql = new Map();
    for (const event of events) if (!bySql.has(event.query) || bySql.get(event.query).durationMs < event.durationMs) bySql.set(event.query, event);
    const observedQueryCount = events.length;
    const observedDbMs = events.reduce((sum, event) => sum + event.durationMs, 0);
    const candidates = [...bySql.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
    const plans = [];
    for (const event of candidates) {
      try {
        const params = JSON.parse(event.params);
        const statement = event.query.replace(/\$(\d+)/g, (_, index) => sqlLiteral(params[Number(index) - 1]));
        const explained = await db.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
          if (event.observedPlanMode === 'force_custom_plan') await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan');
          if (event.observedWorkMem) await tx.$executeRawUnsafe(`SET LOCAL work_mem = '${event.observedWorkMem}'`);
          const statements = await tx.$queryRawUnsafe('SELECT name,statement,generic_plans::int AS generic_plans,custom_plans::int AS custom_plans,parameter_types::text AS parameter_types FROM pg_prepared_statements');
          const prepared = statements.find(row => row.statement.trim() === event.query.trim());
          let actualPreparedPlan = null, forcedCustomPlan = null;
          if (prepared) {
            const executeSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE "${prepared.name.replace(/"/g, '""')}" (${params.map(sqlLiteral).join(',')})`;
            const execution = await tx.$queryRawUnsafe(executeSql);
            actualPreparedPlan = execution[0]['QUERY PLAN'][0];
            if (prepared.generic_plans > 0) {
              await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan');
              const custom = await tx.$queryRawUnsafe(executeSql);
              forcedCustomPlan = custom[0]['QUERY PLAN'][0];
            }
          }
          const literal = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
          return { literal: literal[0]['QUERY PLAN'][0], actualPreparedPlan, forcedCustomPlan, preparedStatement: prepared ? { name: prepared.name, genericPlans: prepared.generic_plans, customPlans: prepared.custom_plans, parameterTypes: prepared.parameter_types } : null };
        }, { timeout: 35000 });
        plans.push({ observedQueryMs: event.durationMs, sql: event.query, observedPlanMode: event.observedPlanMode, observedWorkMem: event.observedWorkMem, plan: explained.literal, actualPreparedPlan: explained.actualPreparedPlan, forcedCustomPlan: explained.forcedCustomPlan, preparedStatement: explained.preparedStatement });
      } catch (error) { plans.push({ observedQueryMs: event.durationMs, sql: event.query, error: safeError(error) }); }
    }
    const p95 = percentile(0.95);
    const result = { workload, processColdMs: round(cold.ms), warm: { samples, warmups: 2, p50Ms: percentile(0.5), p95Ms: p95,
      minMs: round(sorted[0]), maxMs: round(sorted[sorted.length - 1]), valuesMs: measurements.map(row => round(row.ms)) },
      responseBytes: measurements[measurements.length - 1].bytes, targetP95Ms: targets[workload], targetMet: p95 <= targets[workload],
      queries: { totalObserved: observedQueryCount, uniqueStatements: bySql.size, summedDurationMs: observedDbMs, meanSummedDurationPerCallMs: round(observedDbMs / (samples + 3)) }, plans,
      summary: workload.startsWith('report') ? { returnedSales: cold.result.sales.length, pagination: cold.result.pagination } : undefined };
    process.stdout.write(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}

async function run(target) {
  const db = connect(target.url);
  let fixture, postgres, migrations;
  try {
    fixture = await requireFixture(db);
    const [row] = await db.$queryRaw`SELECT version() AS version`; postgres = row.version;
    migrations = await db.$queryRaw`SELECT migration_name AS name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    const pending = fs.readdirSync(path.join(backend, 'prisma/reconciled/migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).filter(name => !migrations.some(applied => applied.name === name));
    if (pending.length) throw new Error('The owned benchmark fixture has pending reviewed migrations; run prepare to apply them without reseeding.');
  }
  finally { await db.$disconnect(); }
  const selected = process.env.POS_BENCHMARK_WORKLOADS ? process.env.POS_BENCHMARK_WORKLOADS.split(',') : workloads;
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(name => !workloads.includes(name))) throw new Error('POS_BENCHMARK_WORKLOADS must contain unique known workload names separated by commas.');
  const output = path.resolve(root, process.env.POS_BENCHMARK_OUTPUT || path.join('.local', 'performance', new Date().toISOString().replace(/[:.]/g, '-') + '.json'));
  if (!output.startsWith(root + path.sep)) throw new Error('Benchmark artifacts must stay inside this workspace.');
  if (fs.existsSync(output)) throw new Error('Choose a new artifact filename; existing files are not overwritten.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const report = { version: 1, status: 'RUNNING', coverage: selected.length === workloads.length ? 'COMPLETE' : 'PARTIAL', createdAt: new Date().toISOString(), fixture, sourceFiles: sourceFingerprint(), database: { name: target.name, postgres, migrations },
    environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramGiB: round(os.totalmem() / 1024 ** 3) },
    method: 'Sequential service calls in separate fresh Node processes. First call includes imports, pool startup and serialization; warm calls follow two warmups. OS/PostgreSQL caches are not flushed. No concurrent load or browser/network/auth timing is included. Percentiles use nearest rank.', results: [] };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Evidence: ${path.relative(root, output)}.`);
  for (const workload of selected) {
    console.log(`Measuring ${workload}...`);
    const child = spawnSync(process.execPath, [__filename, '_worker', workload], { cwd: root, env: { ...process.env, DATABASE_URL_BENCHMARK: target.url },
      encoding: 'utf8', windowsHide: true, maxBuffer: 30 * 1024 * 1024, timeout: 240000 });
    if (child.status !== 0) {
      report.results.push({ workload, error: safeError(child.stderr || child.stdout || child.error?.message || 'worker failed').slice(-4000) });
      console.log(`${workload}: failed (see artifact).`);
    } else {
      const result = JSON.parse(child.stdout); report.results.push(result);
      console.log(`${workload}: cold ${result.processColdMs}ms, warm p50 ${result.warm.p50Ms}ms / p95 ${result.warm.p95Ms}ms (${result.warm.samples} samples); target ${result.targetMet ? 'PASS' : 'MISS'}.`);
    }
    save();
  }
  report.status = 'COMPLETE';
  report.sourceUnchangedDuringRun = JSON.stringify(report.sourceFiles) === JSON.stringify(sourceFingerprint());
  report.accepted = report.sourceUnchangedDuringRun && report.results.every(result => !result.error && result.targetMet && result.plans?.every(plan => !plan.error));
  const content = JSON.stringify(report, null, 2) + '\n'; save();
  console.log(`Artifact: ${path.relative(root, output)} (${crypto.createHash('sha256').update(content).digest('hex')}).`);
  if (!report.accepted) process.exitCode = 1;
}

(async () => {
  if (command === 'help' || command === '--help') {
    console.log('Usage: node scripts/pos-performance.cjs prepare|run|all\nOptional DATABASE_URL_BENCHMARK (localhost, distinct _benchmark DB), POS_BENCHMARK_SAMPLES (5..100, default10), POS_BENCHMARK_OUTPUT (workspace path).\nprepare creates/migrates/seeds an empty owned database. Nothing is dropped or truncated. run measures only the verified fixture.');
    return;
  }
  const target = safeTarget();
  if (command === 'prepare' || command === 'all') await prepare(target);
  if (command === 'run' || command === 'all') await run(target);
  if (command === '_worker') await worker(target, process.argv[3]);
  if (!['prepare', 'run', 'all', '_worker'].includes(command)) throw new Error('Use prepare, run, or all');
})().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
