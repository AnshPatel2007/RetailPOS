// Repeatable checks against dedicated disposable databases, never store records.
'use strict';
const path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, 'backend/.env') });
process.env.TS_NODE_PROJECT = path.join(root, 'backend/tsconfig.json');
require('ts-node/register');
const { assertDisposableDatabase } = require('../backend/src/utils/testDatabase');
const { PrismaClient } = require('@prisma/client');
const operational = process.env.DATABASE_URL;
const source = new URL(operational);
if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw Error('Use a local development PostgreSQL source for this verifier');
const target = suffix => {
  const url = new URL(source); url.pathname = source.pathname + '_reliability_' + suffix;
  return assertDisposableDatabase(url.toString(), operational);
};
const testUrl = target('test'), browserUrl = target('e2e');
const run = (file, args, env = process.env, cwd = root) => {
  const result = cp.spawnSync(process.execPath, [file, ...args], { env, cwd, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw Error('Verification command failed: ' + path.basename(file));
};
(async () => {
  const mode = process.argv[2], files = process.argv.slice(3);
  if (mode === 'prepare') {
    const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try {
      for (const url of [testUrl, browserUrl]) {
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        const exists = await admin.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${name}`;
        if (!exists.length) await admin.$executeRawUnsafe('CREATE DATABASE "' + name.replaceAll('"', '""') + '"');
        for (const command of ['deploy', 'check']) run(path.join(root, 'backend/scripts/migrate.cjs'), [command], { ...process.env, DATABASE_URL: url });
      }
    } finally { await admin.$disconnect(); }
  } else if (mode === 'backend') {
    run(require.resolve('jest/bin/jest'), ['--runInBand', ...(files.length ? ['--runTestsByPath', ...files] : [])],
      { ...process.env, DATABASE_URL_TEST: testUrl }, path.join(root, 'backend'));
  } else if (mode === 'browser') {
    run(require.resolve('@playwright/test/cli'), ['test', ...(files.length ? files : ['e2e'])],
      { ...process.env, DATABASE_URL_E2E: browserUrl, E2E_BROWSER_CHANNEL: process.env.E2E_BROWSER_CHANNEL || 'msedge' }, path.join(root, 'frontend'));
  } else throw Error('Use prepare, backend [test paths], or browser [spec paths]');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
