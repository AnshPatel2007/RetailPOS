import ExcelJS from 'exceljs';
import type { ProfitAndLossReport } from './profitAndLossExport';

type Amount = number | null;
export interface PnlWorkbookMonth {
  store: { id: string; name: string }; month: string;
  period: ProfitAndLossReport['period'];
  days: { date: string; sales: number; tax: Amount; refunds: number; voids: number; netSales: Amount;
    register1: Amount; tax1: Amount; register2: Amount; tax2: Amount; card: number; lotteryNet: Amount }[];
  expenses: { description: string; category: string; amount: number; sourceType: string; expenseDate: string }[];
  income: { kind: string; amount: number }[];
  metrics: { grossCollected: number; netSales: Amount; netTax: Amount; refunds: number; voids: number;
    recordedSaleCosts?: Amount; inventoryCostAdjustments?: Amount; receivedInventoryPurchases?: number;
    expenses: number; otherIncome: number; inventoryPurchases: number; costOfGoodsSold: Amount; grossProfit: Amount;
    netProfit: Amount; grossMargin: Amount; unavailableReason: string | null; historyWarning: string | null };
  estimate: ProfitAndLossReport['estimate'];
  reconciliation?: { opening: { value: Amount }; closing: { value: Amount }; movements: { kind: string; value: Amount }[]; inTransit: { value: Amount; quantity: number } };
}
export type PnlWorkbookReport = ProfitAndLossReport & { workbook: { months: PnlWorkbookMonth[] } };

const navy = '172D46', teal = 'DFF1EE', muted = '64748B', blue = '1755A1';
const currency = '#,##0.00;[Red](#,##0.00);"—"';
const percent = '0.00%;[Red](0.00%);"—"';
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fill = (color: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });
function text(sheet: ExcelJS.Worksheet, row: number, from: number, to: number, value: string) {
  if (to > from) sheet.mergeCells(row, from, row, to);
  const cell = sheet.getCell(row, from); cell.value = value;
  cell.alignment = { vertical: 'middle', wrapText: true };
  return cell;
}
function band(sheet: ExcelJS.Worksheet, row: number, from: number, to: number, label: string) {
  const cell = text(sheet, row, from, to, label);
  cell.fill = fill(navy); cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(row).height = Math.max(sheet.getRow(row).height || 22, 25);
}
function amount(sheet: ExcelJS.Worksheet, row: number, col: number, value: Amount, formula?: string) {
  const cell = sheet.getCell(row, col);
  cell.value = value === null ? null : formula ? { formula, result: value } : value;
  cell.numFmt = currency;
  cell.font = { name: 'Calibri', size: 11, color: { argb: formula ? '172D46' : blue } };
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  return cell;
}
function dates(period: ProfitAndLossReport['period']) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return { start: format.format(new Date(period.start)), end: format.format(new Date(Date.parse(period.end) - Number(period.endExclusive))) };
}
function baseSheet(book: ExcelJS.Workbook, name: string, title: string, subtitle: string) {
  const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 6, showGridLines: false, zoomScale: 85 }],
    pageSetup: { orientation: 'landscape', paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '1:6', margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } } });
  sheet.properties.defaultRowHeight = 18;
  sheet.columns = [{ width: 15 }, ...Array.from({ length: 7 }, () => ({ width: 15 })), { width: 3 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 19 }];
  const heading = text(sheet, 1, 1, 13, title);
  heading.font = { name: 'Calibri', size: 20, bold: true, color: { argb: navy } }; sheet.getRow(1).height = 34;
  text(sheet, 2, 1, 13, subtitle).font = { name: 'Calibri', size: 11, color: { argb: muted } };
  text(sheet, 3, 1, 13, 'RECORDED COSTS').font = { name: 'Calibri', size: 11, bold: true, color: { argb: navy } };
  text(sheet, 4, 1, 13, 'USD • Blank = not supplied or unavailable • Register sales are not cash • Lottery net is sales less payouts, not profit').font = { name: 'Calibri', size: 10, color: { argb: muted } };
  sheet.headerFooter.oddFooter = '&LProfit && Loss&CPage &P of &N';
  return sheet;
}

/** Real numeric XLSX cells with cached formula results; source strings are never formulas. */
export function buildProfitAndLossWorkbook(report: PnlWorkbookReport, _legacyEstimated = false) {
  if (!report.workbook?.months) throw new Error('Monthly report details are unavailable.');
  const book = new ExcelJS.Workbook();
  book.creator = 'POS'; book.created = new Date(report.snapshotAt); book.modified = new Date(report.snapshotAt);
  book.calcProperties.fullCalcOnLoad = true;
  const multi = new Set(report.workbook.months.map(m => m.store.id)).size > 1;
  report.workbook.months.forEach((month, index) => {
    const period = dates(month.period), m = month.metrics;
    const sheet = baseSheet(book, multi ? `${index + 1} ${month.month}` : month.month,
      `${month.store.name} — ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month.month + '-01T00:00:00Z'))}`,
      `${period.start} to ${period.end} • ${month.period.timezone} • Snapshot ${report.snapshotAt}`);
    if (m.costOfGoodsSold === null) sheet.getCell('A3').value = 'RECORDED COSTS • Cost information incomplete';
    else if (m.netProfit === null) sheet.getCell('A3').value = 'RECORDED COSTS • Profit information incomplete';
    ['Date', 'Total sale', 'Reg 1', 'Reg 1 tax', 'Reg 2', 'Reg 2 tax', 'Credit card', 'Lottery net'].forEach((label, i) => band(sheet, 6, i + 1, i + 1, label));
    const keys = ['sales', 'register1', 'tax1', 'register2', 'tax2', 'card', 'lotteryNet'] as const;
    month.days.forEach((day, i) => {
      const row = i + 7;
      sheet.getCell(row, 1).value = new Date(day.date + 'T00:00:00Z'); sheet.getCell(row, 1).numFmt = 'd-mmm-yy';
      sheet.getCell(row, 1).font = { name: 'Calibri', size: 11, color: { argb: navy } };
      sheet.getCell(row, 1).alignment = { vertical: 'middle', horizontal: 'left' };
      keys.forEach((key, k) => amount(sheet, row, k + 2, day[key]));
      if (i % 2 === 0) for (let col = 1; col <= 8; col++) sheet.getCell(row, col).fill = fill('F2F6FA');
    });
    if (!month.days.length) text(sheet, 7, 1, 8, 'No recorded sales or reversals in this period.');
    const totalRow = Math.max(8, month.days.length + 7);
    sheet.getCell(totalRow, 1).value = 'TOTAL';
    keys.forEach((key, i) => {
      const complete = month.days.length > 0 && month.days.every(d => d[key] !== null);
      const value = complete ? round(month.days.reduce((sum, d) => sum + (d[key] || 0), 0)) : key === 'sales' || key === 'card' ? 0 : null;
      amount(sheet, totalRow, i + 2, value, value === null ? undefined : `ROUND(SUM(${String.fromCharCode(66 + i)}7:${String.fromCharCode(66 + i)}${totalRow - 1}),2)`);
    });
    for (let col = 1; col <= 8; col++) { const cell = sheet.getCell(totalRow, col); cell.fill = fill(teal); cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: navy } }; }
    let r = 6;
    const section = (label: string) => { band(sheet, r++, 10, 13, label); };
    const entry = (label: string, value: Amount, formula?: string, total = false) => {
      const row = r++;
      const labelCell = text(sheet, row, 10, 12, label); labelCell.font = { name: 'Calibri', size: 11, color: { argb: navy }, bold: total };
      if (label.length > 76) sheet.getRow(row).height = Math.min(150, Math.ceil(label.length / 76) * 16);
      const cell = amount(sheet, row, 13, value, formula);
      if (value === null) { cell.value = 'Unavailable'; cell.font = { name: 'Calibri', size: 10, color: { argb: muted } }; }
      if (total) { labelCell.fill = fill(teal); cell.fill = fill(teal); cell.font = { ...cell.font, bold: true }; }
      return row;
    };
    section('MONTHLY SALES');
    const sales = entry('Total sale including tax', m.grossCollected, `B${totalRow}`);
    const tax = entry('Net tax collected', m.netTax);
    const refunds = entry('Refunds including tax (deducted)', m.refunds);
    const voids = entry('Voids including tax (deducted)', m.voids);
    const net = entry('Net sales excluding tax', m.netSales, `ROUND(M${sales}-M${tax}-M${refunds}-M${voids},2)`, true);
    r++; section('OPERATING EXPENSES');
    const expenseStart = r;
    month.expenses.forEach(e => entry(e.sourceType === 'MONTHLY_SUMMARY' ? e.description.replace(/^Additional source expense: /, '').replace(' (source total; categories not supplied)', '') : e.description, e.amount));
    const expenses = entry('Total operating expenses', m.expenses, r > expenseStart ? `ROUND(SUM(M${expenseStart}:M${r - 1}),2)` : '0', true);
    r++; section('OTHER INCOME');
    const incomeStart = r;
    month.income.forEach(i => entry(i.kind === 'GAMING_ATM' ? 'Gaming / ATM' : i.kind === 'LOTTERY_COMMISSION' ? 'Legacy lottery commission' : i.kind === 'LOTTERY_EARNINGS' ? 'Confirmed lottery earnings' : i.kind.replace(/_/g, ' '), i.amount));
    const income = entry('Total other income', m.otherIncome, r > incomeStart ? `ROUND(SUM(M${incomeStart}:M${r - 1}),2)` : '0', true);
    r++; section('PROFIT & MARGINS');
    const figures = { ...m, netIncome: m.netProfit, margins: { gross: m.grossMargin, net: m.netSales && m.netProfit !== null ? round(m.netProfit / m.netSales * 100) : null } };
    const saleCosts = m.recordedSaleCosts !== undefined ? entry('Recorded sale costs, net of returns', m.recordedSaleCosts) : null;
    const costAdjustments = m.inventoryCostAdjustments !== undefined ? entry('Inventory / purchase-cost adjustments', m.inventoryCostAdjustments) : null;
    const cost = entry('Cost of goods sold', figures.costOfGoodsSold, saleCosts && costAdjustments ? `ROUND(M${saleCosts}+M${costAdjustments},2)` : undefined);
    const gross = entry('Gross profit', figures?.grossProfit ?? null, `ROUND(M${net}-M${cost},2)`);
    const profit = entry('Net income', figures?.netIncome ?? null, `ROUND(M${gross}-M${expenses}+M${income},2)`, true);
    for (const [label, numerator, value] of [['Gross margin', gross, figures?.margins.gross], ['Net margin', profit, figures?.margins.net]] as const) {
      const row = entry(label, value === null || value === undefined ? null : value / 100, `IF(M${net}=0,"",M${numerator}/M${net})`);
      sheet.getCell(row, 13).numFmt = percent;
    }
    r++; section('INVENTORY PURCHASES (REFERENCE)');
    entry('Inventory received at cost', m.receivedInventoryPurchases ?? null);
    if (m.inventoryPurchases) entry('Inventory purchase expense entries', m.inventoryPurchases);
    if (month.reconciliation) {
      r++; section('INVENTORY RECONCILIATION');
      entry('Opening inventory value', month.reconciliation.opening.value);
      month.reconciliation.movements.forEach(row => entry(row.kind.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()), row.value));
      entry('Closing inventory value', month.reconciliation.closing.value, undefined, true);
      entry(`Inventory in transit (${month.reconciliation.inTransit.quantity} units)`, month.reconciliation.inTransit.value);
    }
    let noteRow = Math.max(totalRow + 2, r + 2);
    const notes = [
      'Sales include tax and credit cards. Register allocations appear only when supplied for every entry that day.',
      ...(month.expenses.some(e => e.sourceType === 'MONTHLY_SUMMARY') ? ['Monthly expense summaries have no supplied daily dates.'] : []),
      'Expense and other income totals include recorded entries only.',
      'Lottery net collections are informational. Confirmed commissions, bonuses and related adjustments count as other income; ticket sales and payouts do not.',
      'Inventory received is a reference amount. Its cost reduces profit as goods sell.',
      ...(m.inventoryPurchases ? ['Inventory purchase expense entries may cover the same deliveries. They are excluded from operating expenses.'] : []),
      ...(m.historyWarning?.includes('Older voids') ? [m.historyWarning] : []), ...(m.unavailableReason ? [m.unavailableReason] : []),
    ];
    for (const note of notes) { text(sheet, noteRow, 1, 13, note).font = { name: 'Calibri', size: 10, color: { argb: muted } }; sheet.getRow(noteRow++).height = note.length > 180 ? 28 : 18; }
    const adjustments = month.days.filter(d => d.refunds || d.voids);
    if (adjustments.length) {
      noteRow++; band(sheet, noteRow++, 1, 8, 'DATED REFUNDS & VOIDS — included in the monthly summary');
      ['Date', 'Refunds', 'Voids', 'Net tax', 'Net sales (ex tax)'].forEach((label, col) => { sheet.getCell(noteRow, col + 1).value = label; });
      sheet.getRow(noteRow++).height = 30;
      adjustments.forEach(d => { sheet.getCell(noteRow, 1).value = d.date; [d.refunds, d.voids, d.tax, d.netSales].forEach((v, i) => amount(sheet, noteRow, i + 2, v)); noteRow++; });
    }
    sheet.pageSetup.printArea = `A1:M${noteRow}`;
    // Keep an ordinary month and its summary together when printed. Long expense
    // lists retain automatic pagination instead of shrinking to unreadable text.
    sheet.pageSetup.fitToHeight = noteRow <= 55 ? 1 : 0;
  });
  // Preserve the displayed period totals alongside the monthly sheets.
  if (report.workbook.months.length > 1) {
    const range = dates(report.period), summary = book.addWorksheet('Period totals');
    summary.columns = [{ width: 48 }, { width: 25 }]; summary.views = [{ showGridLines: false }];
    band(summary, 1, 1, 2, `${report.scope.storeName} — Period totals`);
    text(summary, 2, 1, 2, `${range.start} to ${range.end} • ${report.period.timezone}`);
    const figures = report;
    const rows: [string, Amount][] = [['Net sales excluding tax', report.revenue.netSales], ['Recorded cost of goods sold', figures.costOfGoodsSold],
      ['Gross profit', figures.grossProfit], ['Operating expenses', report.operatingExpenses.total], ['Other income', report.otherIncome],
      ['Net income', figures.netIncome], ['Inventory received at cost (reference)', report.receivedInventoryPurchases ?? null],
      ['Inventory purchase expense entries (reference)', report.inventoryPurchases]];
    rows.forEach(([label, value], i) => { text(summary, i + 4, 1, 1, label); const cell = amount(summary, i + 4, 2, value); if (value === null) cell.value = 'Unavailable'; });
    const noteRow = rows.length + 5;
    text(summary, noteRow, 1, 2, 'Figures use recorded inventory and sale costs. Purchase expense entries may overlap receipts; neither reference total is deducted again.'); summary.getRow(noteRow).height = 60;
    text(summary, noteRow + 2, 1, 2, `Snapshot ${report.snapshotAt}`);
  }
  const range = dates(report.period);
  return { workbook: book, filename: `pnl-${report.scope.locationId || 'all-stores'}-${range.start}-to-${range.end}-recorded.xlsx` };
}

export async function prepareProfitAndLossExcel(report: PnlWorkbookReport, _legacyEstimated = false) {
  const file = buildProfitAndLossWorkbook(report);
  const buffer = await file.workbook.xlsx.writeBuffer();
  return { filename: file.filename, blob: new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
}
