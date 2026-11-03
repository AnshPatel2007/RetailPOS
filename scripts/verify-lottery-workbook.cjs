// Read isolated browser fixtures and verify the actual P&L Excel exporter.
const fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, 'backend/.env'), quiet: true });
const operational = process.env.DATABASE_URL, target = new URL(operational);
if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Local verification only');
target.pathname += '_reliability_e2e';
process.env.TS_NODE_PROJECT = path.join(root, 'backend/tsconfig.json'); require('ts-node/register');
const { assertDisposableDatabase } = require('../backend/src/utils/testDatabase');
process.env.DATABASE_URL = assertDisposableDatabase(target.toString(), operational); process.env.NODE_ENV = 'production';
const prisma = require('../backend/src/config/database').default;
const { getProfitAndLoss } = require('../backend/src/controllers/financial.controller');
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/src/services/profitAndLossWorkbook.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const output = { exports: {} }; vm.runInNewContext(compiled, { exports: output.exports, module: output, Date, require: name => { if (name !== 'exceljs') throw Error('Unexpected dependency'); return { default: require('exceljs') }; } });
const directory = path.join(root, '.local/lottery-workbooks'); fs.mkdirSync(directory, { recursive: true });
(async () => {
  for (const [email, expectedEarnings, expectedCollections] of [['lottery@example.test', 7.5, 150], ['lottery-machine@example.test', 10, -50]]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true, locationId: true } });
    const day = await prisma.lotteryDay.findFirstOrThrow({ where: { locationId: user.locationId, status: 'CLOSED' } });
    const report = await new Promise((resolve, reject) => getProfitAndLoss({ user, query: { startDate: day.businessDate, endDate: day.businessDate, workbook: 'true' } }, { json: body => resolve(JSON.parse(JSON.stringify(body.data))) }, reject));
    assert.equal(report.netIncome, expectedEarnings); assert.equal(report.revenue.netSales, 0); assert.equal(report.costOfGoodsSold, 0);
    const month = report.workbook.months[0]; assert.equal(month.income.reduce((sum, row) => sum + row.amount, 0), expectedEarnings);
    assert.equal(month.days[0].lotteryNet, expectedCollections); assert.equal(month.days[0].sales, 0);
    const name = email.split('@')[0], { workbook } = output.exports.buildProfitAndLossWorkbook(report);
    await workbook.xlsx.writeFile(path.join(directory, name + '.xlsx')); fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(report, null, 2));
    console.log(`${name}: sales $0, COGS $0, lottery earnings $${expectedEarnings}, collections $${expectedCollections}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
