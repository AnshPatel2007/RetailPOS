import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { getSalesReportData } from './salesReport.service';
import { AppError } from '../utils/errorHandler';

export function sendSalesReportPdf(report: Awaited<ReturnType<typeof getSalesReportData>>, res: Response) {
  if (report.entriesPartial) throw new AppError('Reload the complete report before exporting; a report page cannot be exported as the full range.', 409);
  const doc = new PDFDocument({ margin: 40, bufferPages: true });
  const { summary, entries, period } = report;
  const currency = (value: number | null) => value === null ? 'Unavailable' : '$' + value.toFixed(2);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');
  doc.pipe(res);
  doc.fillColor('#2563eb').font('Helvetica-Bold').fontSize(20).text('Sales, Returns and Voids');
  doc.fillColor('#334155').font('Helvetica').fontSize(9).text('Calendar: ' + period.timezone);
  doc.text('From ' + (period.start?.toISOString() || 'all history') + ' to ' + period.end.toISOString() + (period.endExclusive ? ' (exclusive)' : ' (inclusive)'));
  doc.moveDown();
  for (const [label, value] of [
    ['Net collected (including tax)', currency(summary.totalSales)],
    ['Original sales', summary.totalTransactions === null ? 'Unavailable' : String(summary.totalTransactions)], ['Refunds issued', currency(summary.refunds)],
    ['Voids recorded', currency(summary.voids)],
    ['Net sales before tax', currency(summary.netSales)], ['Net tax', currency(summary.totalTax)],
    ['Original discounts', currency(summary.totalDiscount)],
  ]) doc.text(label + ': ' + value);
  doc.moveDown();
  doc.text('Returns and voids use their reversal date. Employee, customer and amount filters refer to the original sale; tender filters match its primary tender label. Payment totals use recorded split allocations and actual refund destinations.');
  if (report.historyWarning) doc.text(report.historyWarning);
  doc.moveDown();
  doc.font('Helvetica-Bold').text('Activity by payment method').font('Helvetica');
  for (const [method, value] of Object.entries(report.paymentBreakdown)) doc.text(method + ': ' + currency(value.total));
  doc.moveDown();
  if (Object.keys(report.dailyBreakdown).length > 1) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.font('Helvetica-Bold').text('Daily net collected (' + period.timezone + ')').font('Helvetica');
    for (const [day, value] of Object.entries(report.dailyBreakdown).sort()) {
      if (doc.y > doc.page.height - 70) doc.addPage();
      doc.text(day + ': ' + currency(value.total));
    }
    doc.moveDown();
  }
  const width = doc.page.width - 80;
  const columns = [40, 95, 260, 340, 415, 485];
  const widths = [50, 160, 75, 70, 65, 80];
  const header = () => {
    const y = doc.y;
    doc.rect(40, y, width, 20).fill('#eef2ff');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8);
    ['ENTRY', 'SALE #', 'STORE DATE', 'METHOD', 'TAX', 'TOTAL'].forEach((value, index) => doc.text(value, columns[index], y + 6, { width: widths[index] }));
    doc.font('Helvetica'); doc.y = y + 24;
  };
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.font('Helvetica-Bold').text('Sales and return entries (' + entries.length + ')');
  doc.moveDown(); header();
  const dates = new Intl.DateTimeFormat('en-CA', { timeZone: period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  entries.forEach((entry, row) => {
    const values = [entry.sourceType === 'DAILY_SUMMARY' ? 'Daily summary' : entry.kind, entry.saleNumber, dates.format(entry.createdAt), entry.sourceType === 'DAILY_SUMMARY' ? 'Card recorded; remainder unspecified' : entry.method, currency(entry.tax), currency(entry.total)];
    const height = Math.max(20, ...values.map((value, index) => doc.heightOfString(value, { width: widths[index] }) + 8));
    if (doc.y + height > doc.page.height - 60) { doc.addPage(); header(); }
    const y = doc.y;
    if (row % 2 === 0) doc.rect(40, y, width, height).fill('#f8fafc');
    doc.fillColor('#1e293b');
    values.forEach((value, index) => doc.text(value, columns[index], y + 4, { width: widths[index] }));
    doc.y = y + height;
  });
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    // Put the footer inside the bottom margin without creating another page.
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#64748b').text('Page ' + (i + 1) + ' of ' + pages.count, 40, doc.page.height - 25, { width, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
