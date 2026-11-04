// The old migrations remain immutable evidence. New deployments use the
// reconciled baseline and reviewed forward migrations, never db push.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const schema = path.join(root, 'prisma/reconciled/schema.prisma');
fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), schema);
const cli = require.resolve('prisma/build/index.js');
const command = process.argv[2] || 'deploy';
if (!['deploy', 'baseline', 'bridge', 'status', 'check'].includes(command)) throw new Error('Use deploy, bridge, baseline, status, or check');
function prisma(args, capture = false) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env: process.env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}
const baselineSchema = path.join(root, 'prisma/reconciled/baseline.prisma');
const bridgeDir = path.join(root, 'prisma/reconciled/bridges');
const normalizeSql = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
function pendingToBaseline() {
  const diff = prisma(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', baselineSchema, '--script'], true);
  if (diff.status !== 0) {
    console.error(diff.stdout, diff.stderr);
    process.exit(1);
  }
  return normalizeSql(diff.stdout);
}

// An installation built with `db push` from an older release can be short of
// the baseline by purely additive changes. Apply a reviewed bridge only when
// the database differs from the baseline by exactly that bridge's SQL.
if (command === 'bridge') {
  const pending = pendingToBaseline();
  if (!pending) {
    console.log('The database already matches the baseline. No bridge needed.');
    process.exit(0);
  }
  const bridges = fs.existsSync(bridgeDir) ? fs.readdirSync(bridgeDir).filter(name => name.endsWith('.sql')).sort() : [];
  const match = bridges.find(name => normalizeSql(fs.readFileSync(path.join(bridgeDir, name), 'utf8')) === pending);
  if (!match) {
    console.error('Bridge refused: the database differs from the baseline in a way no reviewed bridge covers. Investigate a restored clone; do not force it.');
    process.exit(1);
  }
  const script = path.join(bridgeDir, `.apply-${process.pid}.sql`);
  fs.writeFileSync(script, `BEGIN;\n${fs.readFileSync(path.join(bridgeDir, match), 'utf8')}\nCOMMIT;\n`);
  try {
    const applied = prisma(['db', 'execute', '--file', script, '--schema', schema]);
    if (applied.status !== 0) process.exit(applied.status ?? 1);
  } finally {
    fs.rmSync(script, { force: true });
  }
  if (pendingToBaseline()) {
    console.error(`Bridge ${match} ran but the database still differs from the baseline.`);
    process.exit(1);
  }
  console.log(`Applied bridge ${match}. The database now matches the baseline; run db:baseline next.`);
  process.exit(0);
}
if (command === 'baseline') {
  const diff = prisma(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', baselineSchema, '--exit-code'], true);
  if (diff.status !== 0) {
    console.error('Baseline refused: the database differs from the reviewed baseline. Reconcile a restored clone first.');
    console.error(diff.stdout, diff.stderr);
    process.exit(1);
  }
  process.exit(prisma(['migrate', 'resolve', '--applied', '20261013000000_baseline', '--schema', schema]).status ?? 1);
}
if (command === 'check') {
  process.exit(prisma(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code']).status ?? 1);
}
process.exit(prisma(['migrate', command, '--schema', schema]).status ?? 1);
