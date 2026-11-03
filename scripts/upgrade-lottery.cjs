// Local additive upgrade with a verified backup and unchanged business-row proof.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, 'backend/.env'), quiet: true });
const source = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw Error('This upgrade requires a local database');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const artifact = path.join(root, '.local', 'backups', 'lottery-' + new Date().toISOString().replace(/[:.]/g, '-'));
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
async function fingerprint(columns) {
  const result = {};
  for (const [table, names] of Object.entries(columns)) {
    const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS hash FROM (SELECT ${names.map(identifier).join(',')} FROM ${identifier(table)}) t`);
    result[table] = row;
  }
  return result;
}
(async () => {
  fs.mkdirSync(artifact, { recursive: true });
  const rows = await db.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') ORDER BY table_name, ordinal_position`;
  const columns = {}; for (const row of rows) (columns[row.table_name] ||= []).push(row.column_name);
  const before = await fingerprint(columns);
  const dump = path.join(artifact, 'before-lottery.dump');
  const result = cp.spawnSync(path.join(process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin', 'pg_dump.exe'),
    ['--format=custom', '--file=' + dump, '--dbname=' + decodeURIComponent(source.pathname.slice(1))], {
      env: { ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432', PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) },
      windowsHide: true, encoding: 'utf8',
    });
  if (result.status !== 0) throw Error('Database backup failed; no migration applied');
  fs.writeFileSync(path.join(artifact, 'manifest.json'), JSON.stringify({ columns, before, sha256: crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex') }, null, 2));
  if (JSON.stringify(before) !== JSON.stringify(await fingerprint(columns))) throw Error('Business data changed during backup. Retry before migration.');
  const log = fs.openSync(path.join(artifact, 'migration.log'), 'w');
  try {
    for (const command of ['deploy', 'check']) {
      const migration = cp.spawnSync(process.execPath, ['backend/scripts/migrate.cjs', command], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', log, log] });
      if (migration.status !== 0) throw Error('Migration failed; inspect ' + path.join(artifact, 'migration.log'));
    }
  } finally { fs.closeSync(log); }
  const after = await fingerprint(columns);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Business rows changed; inspect the backup before proceeding');
  fs.writeFileSync(path.join(artifact, 'verification.json'), JSON.stringify({ originalBusinessRowsPreserved: true, tablesChecked: Object.keys(columns).length, after }, null, 2));
  console.log(JSON.stringify({ backup: artifact, originalBusinessRowsPreserved: true, tablesChecked: Object.keys(columns).length }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
