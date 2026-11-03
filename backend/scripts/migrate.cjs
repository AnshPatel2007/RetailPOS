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
if (!['deploy', 'baseline', 'status', 'check'].includes(command)) throw new Error('Use deploy, baseline, status, or check');
function prisma(args, capture = false) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env: process.env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}
if (command === 'baseline') {
  const diff = prisma(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', path.join(root, 'prisma/reconciled/baseline.prisma'), '--exit-code'], true);
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
