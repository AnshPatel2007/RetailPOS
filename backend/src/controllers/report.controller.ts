import { valueProducts, sumInventoryValue } from '../services/inventoryValueRead.service';
import { z } from 'zod';
import { deliverySelect, retryEmailDelivery } from '../services/emailDelivery.service';
import { getDashboardReportData, getDashboardWidgetData } from '../services/dashboardReport.service';
import { getEmployeeReportData } from '../services/employeeReport.service';
import { getOverallReportData } from '../services/overallReport.service';
import { expensePeriod } from '../services/expenseDates.service';
import { getSalesReportData, salesReportCSV } from '../services/salesReport.service';
import { sendSalesReportPdf } from '../services/salesReportPdf.service';
import { Response } from 'express';
import { getReportRange } from '../services/reportDates.service';
import { getProductFinancialMetrics } from '../services/financialMetrics.service';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';
import { SaleStatus, ExpenseStatus, Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import { createDateFilter } from '../utils/dateFilter.util';
import { parseListFilter } from '../utils/queryFilter.util';
import { getLocationFilter } from '../utils/locationFilter.util';

/** Round a number to 2 decimal places (currency precision) */
const rc = (n: number) => Math.round(n * 100) / 100;

/** GET /api/reports/overall: one consistent financial snapshot. */
export const getOverallReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  res.json({ success: true, data: await getOverallReportData(scope) });
});

/** Store-scoped financial activity; cashier visibility follows their original sales. */
const dashboardScope = (req: AuthRequest) => ({ ...getLocationFilter(req, req.query.locationId as string),
  ...(req.user?.role === 'CASHIER' ? { userId: req.user.id } : {}) });
export const getDashboardMetrics = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getDashboardReportData(dashboardScope(req)) });
});
export const getDashboardHourly = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getDashboardWidgetData(dashboardScope(req)) });
});

/**
 * Get sales report
 * GET /api/reports/sales
 */
export const getSalesReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await getSalesReportData(req);
  res.json({ success: true, data });
});

/**
 * Get inventory report
 * GET /api/reports/inventory
 */
export const getInventoryReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { categoryId, lowStock, locationId } = req.query;

  const where: any = { isActive: true, ...getLocationFilter(req, locationId as string) };

  if (categoryId) where.categoryId = categoryId;

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      image: true,
      barcode: true,
      cost: true,
      price: true,
      compareAtPrice: true,
      stockQuantity: true,
      lowStockAlert: true,
      categoryId: true,
      isActive: true,
      isTaxable: true,
      trackInventory: true,
      allowBackorder: true,
      createdAt: true,
      updatedAt: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = await valueProducts(prisma, products);
  if (lowStock === 'true') {
    filteredProducts = filteredProducts.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Calculate totals
  const totalInventoryValue = sumInventoryValue(filteredProducts);

  const totalRetailValue = rc(filteredProducts.reduce(
    (sum, p) => sum + rc(Number(p.price) * p.stockQuantity),
    0
  ));

  const lowStockCount = filteredProducts.filter(
    (p) => p.stockQuantity <= p.lowStockAlert
  ).length;

  res.json({
    success: true,
    data: {
      products: filteredProducts,
      summary: {
        totalProducts: filteredProducts.length,
        totalInventoryValue,
        totalRetailValue: Math.round(totalRetailValue * 100) / 100,
        potentialProfit: totalInventoryValue === null ? null : Math.round((totalRetailValue - totalInventoryValue) * 100) / 100,
        lowStockCount,
      },
    },
  });
});

/**
 * Get employee performance report
 * GET /api/reports/employees
 */
export const getEmployeeReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  const { rows, ...meta } = await getEmployeeReportData(scope, req.query.startDate, req.query.endDate);
  res.json({ success: true, data: rows, ...meta });
});

/**
 * Get product sales report
 * GET /api/reports/products
 */
export const getProductSalesReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, limit = 20, locationId } = req.query;
  const scope = getLocationFilter(req, locationId as string);
  const { range } = await getReportRange(scope, startDate, endDate);
  const data = await getProductFinancialMetrics(scope, range);
  res.json({ success: true, data: data.sort((a, b) => b.revenue - a.revenue).slice(0, Math.min(500, Math.max(1, Number(limit) || 20))) });
});

/**
 * Get expense report
 * GET /api/reports/expenses
 */
export const getExpenseReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, category, status, locationId } = req.query;

  const scope = getLocationFilter(req, locationId as string);
  const { range: dateFilter, timezone } = await expensePeriod(scope, startDate, endDate);
  const where: any = { locationId: scope.locationId || { not: null } };

  if (category) {
    where.category = parseListFilter(category);
  }

  if (status) {
    where.status = parseListFilter(status);
  } else {
    // Consistent with the overall report: rejected expenses aren't real spend
    where.status = { not: ExpenseStatus.REJECTED };
  }

  if (dateFilter) {
    where.expenseDate = dateFilter;
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          name: true, timezone: true,
        },
      },
    },
    orderBy: {
      expenseDate: 'desc',
    },
  });

  // Calculate summary
  const totalExpenses = rc(expenses.reduce((sum, exp) => sum + Number(exp.amount), 0));
  const pendingExpenses = rc(expenses
    .filter((exp) => exp.status === 'PENDING')
    .reduce((sum, exp) => sum + Number(exp.amount), 0));
  const paidExpenses = rc(expenses
    .filter((exp) => exp.status === 'PAID')
    .reduce((sum, exp) => sum + Number(exp.amount), 0));

  // Group by category
  const byCategory = expenses.reduce((acc: any, exp) => {
    if (!acc[exp.category]) {
      acc[exp.category] = {
        category: exp.category,
        count: 0,
        total: 0,
      };
    }
    acc[exp.category].count++;
    acc[exp.category].total = rc(acc[exp.category].total + Number(exp.amount));
    return acc;
  }, {});

  const categorySummary = Object.values(byCategory).map((cat: any) => ({
    ...cat,
    percentage: totalExpenses > 0 ? rc((cat.total / totalExpenses) * 100) : 0,
  }));

  // Find top category
  const topCategory = categorySummary.reduce((top: any, cat: any) => {
    return !top || cat.total > top.total ? cat : top;
  }, null);

  // Calculate average daily expense
  const daysInPeriod = startDate && endDate
    ? Math.max(
        1,
        Math.ceil(
          (new Date(endDate as string).getTime() - new Date(startDate as string).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 30;
  const avgDailyExpense = rc(totalExpenses / daysInPeriod);

  res.json({
    success: true,
    data: {
      period: { timezone },
      expenses: req.user?.role === 'ADMIN' ? expenses : expenses.filter(e => e.category !== 'PAYROLL'),
      summary: {
        totalExpenses,
        pendingExpenses,
        paidExpenses,
        byCategory: categorySummary,
        topCategory: topCategory?.category || 'N/A',
        avgDailyExpense,
      },
    },
  });
});

/**
 * Export sales report to CSV
 * GET /api/reports/sales/export/csv
 */
export const exportSalesCSV = asyncHandler(async (req: AuthRequest, res: Response) => {
  const report = await getSalesReportData(req, { forExport: true });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=sales-export.csv');
  res.send(salesReportCSV(report));
});

const PRIMARY_COLOR = '#2563eb';
const DARK_COLOR = '#1e293b';
const MUTED_COLOR = '#64748b';
const BORDER_COLOR = '#e2e8f0';
const BG_LIGHT = '#f8fafc';

function drawPdfHeader(doc: any, title: string, subtitle?: string) {
  // Blue banner
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY_COLOR);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
    .text(title, 50, 25, { align: 'left' });
  doc.fontSize(10).font('Helvetica')
    .text('POS System', 50, 52, { align: 'left' });
  doc.fontSize(9)
    .text(`Generated: ${new Date().toLocaleString()}`, doc.page.width - 250, 30, { width: 200, align: 'right' });
  if (subtitle) {
    doc.text(subtitle, doc.page.width - 250, 45, { width: 200, align: 'right' });
  }
  doc.fillColor(DARK_COLOR);
  doc.y = 100;
}

function drawSummaryBox(doc: any, items: { label: string; value: string }[], columns = 3) {
  const startX = 50;
  const boxWidth = (doc.page.width - 100) / columns;
  const startY = doc.y;

  doc.rect(startX, startY, doc.page.width - 100, 60).fill(BG_LIGHT).stroke(BORDER_COLOR);

  items.forEach((item, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = startX + col * boxWidth + 15;
    const y = startY + row * 30 + 10;

    doc.fillColor(MUTED_COLOR).fontSize(8).font('Helvetica').text(item.label, x, y);
    doc.fillColor(DARK_COLOR).fontSize(13).font('Helvetica-Bold').text(item.value, x, y + 11);
  });

  doc.fillColor(DARK_COLOR);
  doc.y = startY + Math.ceil(items.length / columns) * 30 + 20;
}

function drawSectionTitle(doc: any, title: string) {
  doc.moveDown(0.5);
  doc.fillColor(PRIMARY_COLOR).fontSize(12).font('Helvetica-Bold').text(title);
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(PRIMARY_COLOR).lineWidth(1.5).stroke();
  doc.fillColor(DARK_COLOR).moveDown(0.5);
}

function drawTableHeader(doc: any, columns: { label: string; x: number; width: number; align?: string }[]) {
  const y = doc.y;
  doc.rect(50, y, doc.page.width - 100, 18).fill('#eef2ff');
  doc.fillColor(DARK_COLOR).fontSize(8).font('Helvetica-Bold');
  columns.forEach(col => {
    doc.text(col.label, col.x, y + 5, { width: col.width, align: (col.align as any) || 'left' });
  });
  doc.fillColor(DARK_COLOR).font('Helvetica');
  doc.y = y + 20;
}

function drawTableRow(doc: any, columns: { value: string; x: number; width: number; align?: string }[], index: number) {
  const y = doc.y;
  if (index % 2 === 0) {
    doc.rect(50, y - 1, doc.page.width - 100, 15).fill(BG_LIGHT);
  }
  doc.fillColor(DARK_COLOR).fontSize(8).font('Helvetica');
  columns.forEach(col => {
    doc.text(col.value, col.x, y + 2, { width: col.width, align: (col.align as any) || 'left' });
  });
  doc.y = y + 15;
}

function checkPageBreak(doc: any, needed = 50) {
  if (doc.y > doc.page.height - needed) {
    doc.addPage();
    return true;
  }
  return false;
}

function drawFooter(doc: any) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED_COLOR).fontSize(7).font('Helvetica');
    doc.text(`Page ${i + 1} of ${pages.count}`, 50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });
  }
}

/**
 * Export sales report to PDF
 * GET /api/reports/sales/export/pdf
 */
export const exportSalesPDF = asyncHandler(async (req: AuthRequest, res: Response) => {
  sendSalesReportPdf(await getSalesReportData(req, { forExport: true }), res);
});

/**
 * Export inventory report to CSV
 * GET /api/reports/inventory/export/csv
 */
export const exportInventoryCSV = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { Parser } = require('json2csv');
  const { categoryId, lowStock, minPrice, maxPrice, locationId } = req.query;

  const where: any = { isActive: true, ...getLocationFilter(req, locationId as string) };

  if (categoryId) where.categoryId = categoryId;

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = parseFloat(minPrice as string);
    if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = await valueProducts(prisma, products);
  if (lowStock === 'true') {
    filteredProducts = filteredProducts.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Transform data for CSV
  const csvData = filteredProducts.map((product) => ({
    'SKU': product.sku,
    'Name': product.name,
    'Category': product.category?.name || 'Uncategorized',
    'Stock Quantity': product.stockQuantity,
    'Low Stock Alert': product.lowStockAlert,
    'Latest Supplier Price': product.cost.toFixed(2), 'Average Inventory Cost': product.averageCost?.toFixed(8) ?? 'Unavailable',
    'Price': product.price.toFixed(2),
    'Inventory Value': product.inventoryValue?.toFixed(2) ?? 'Unavailable',
    'Retail Value': (Number(product.price) * product.stockQuantity).toFixed(2),
    'Barcode': product.barcode || '',
    'Track Inventory': product.trackInventory ? 'Yes' : 'No',
    'Is Active': product.isActive ? 'Yes' : 'No',
  }));

  const parser = new Parser();
  const csv = parser.parse(csvData);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-export.csv');
  res.send(csv);
});

/**
 * Export inventory report to PDF
 * GET /api/reports/inventory/export/pdf
 */
export const exportInventoryPDF = asyncHandler(async (req: AuthRequest, res: Response) => {
  const PDFDocument = require('pdfkit');
  const { categoryId, lowStock, minPrice, maxPrice, locationId } = req.query;

  const where: any = { isActive: true, ...getLocationFilter(req, locationId as string) };

  if (categoryId) where.categoryId = categoryId;

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = parseFloat(minPrice as string);
    if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  let filteredProducts = await valueProducts(prisma, products);
  if (lowStock === 'true') {
    filteredProducts = filteredProducts.filter(p => p.trackInventory && p.stockQuantity <= p.lowStockAlert);
  }

  // Calculate summary
  const totalInventoryValue = sumInventoryValue(filteredProducts);
  const totalRetailValue = rc(filteredProducts.reduce((sum, p) => sum + rc(Number(p.price) * p.stockQuantity), 0));
  const potentialProfit = totalInventoryValue === null ? null : rc(totalRetailValue - totalInventoryValue);
  const lowStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity <= p.lowStockAlert).length;
  const outOfStockCount = filteredProducts.filter((p) => p.trackInventory && p.stockQuantity === 0).length;
  const margin = potentialProfit !== null && totalRetailValue > 0 ? rc((potentialProfit / totalRetailValue) * 100) : null;

  // Category breakdown
  const categoryBreakdown = filteredProducts.reduce((acc: any, product) => {
    const catName = product.category?.name || 'Uncategorized';
    if (!acc[catName]) acc[catName] = { count: 0, costValue: 0, retailValue: 0, stock: 0 };
    acc[catName].count++;
    acc[catName].costValue = acc[catName].costValue === null || product.inventoryValue === null ? null : rc(acc[catName].costValue + product.inventoryValue);
    acc[catName].retailValue = rc(acc[catName].retailValue + rc(Number(product.price) * product.stockQuantity));
    acc[catName].stock += product.stockQuantity;
    return acc;
  }, {});

  const doc = new PDFDocument({ margin: 50, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-report.pdf');
  doc.pipe(res);

  drawPdfHeader(doc, 'Inventory Report');

  drawSummaryBox(doc, [
    { label: 'TOTAL PRODUCTS', value: filteredProducts.length.toString() },
    { label: 'INVENTORY VALUE (COST)', value: totalInventoryValue === null ? 'Unavailable' : '$' + totalInventoryValue.toFixed(2) },
    { label: 'RETAIL VALUE', value: `$${totalRetailValue.toFixed(2)}` },
    { label: 'POTENTIAL PROFIT', value: potentialProfit === null ? 'Unavailable' : '$' + potentialProfit.toFixed(2) },
    { label: 'PROFIT MARGIN', value: margin === null ? 'Unavailable' : margin.toFixed(1) + '%' },
    { label: 'LOW / OUT OF STOCK', value: `${lowStockCount} / ${outOfStockCount}` },
  ]);

  // Category breakdown table
  drawSectionTitle(doc, 'Inventory by Category');
  const catCols = [
    { label: 'CATEGORY', x: 50, width: 120 },
    { label: 'PRODUCTS', x: 170, width: 60, align: 'right' },
    { label: 'TOTAL STOCK', x: 230, width: 70, align: 'right' },
    { label: 'COST VALUE', x: 310, width: 80, align: 'right' },
    { label: 'RETAIL VALUE', x: 400, width: 80, align: 'right' },
  ];
  drawTableHeader(doc, catCols);
  Object.entries(categoryBreakdown).forEach(([cat, data]: [string, any], i) => {
    drawTableRow(doc, [
      { value: cat, x: 50, width: 120 },
      { value: data.count.toString(), x: 170, width: 60, align: 'right' },
      { value: data.stock.toString(), x: 230, width: 70, align: 'right' },
      { value: data.costValue === null ? 'Unavailable' : '$' + data.costValue.toFixed(2), x: 310, width: 80, align: 'right' },
      { value: `$${data.retailValue.toFixed(2)}`, x: 400, width: 80, align: 'right' },
    ], i);
  });

  // Product details
  doc.addPage();
  drawSectionTitle(doc, `Product Details (${filteredProducts.length} items)`);

  const prodCols = [
    { label: 'SKU', x: 50, width: 70 },
    { label: 'PRODUCT', x: 120, width: 130 },
    { label: 'CATEGORY', x: 250, width: 75 },
    { label: 'STOCK', x: 325, width: 45, align: 'right' },
    { label: 'COST', x: 370, width: 55, align: 'right' },
    { label: 'PRICE', x: 425, width: 55, align: 'right' },
    { label: 'VALUE', x: 480, width: 65, align: 'right' },
  ];
  drawTableHeader(doc, prodCols);

  filteredProducts.forEach((product, i) => {
    checkPageBreak(doc, 20);
    const isLow = product.trackInventory && product.stockQuantity <= product.lowStockAlert;
    const stockStr = isLow ? `${product.stockQuantity} !` : product.stockQuantity.toString();
    drawTableRow(doc, [
      { value: product.sku, x: 50, width: 70 },
      { value: product.name.substring(0, 25), x: 120, width: 130 },
      { value: (product.category?.name || 'N/A').substring(0, 15), x: 250, width: 75 },
      { value: stockStr, x: 325, width: 45, align: 'right' },
      { value: `$${product.cost.toFixed(2)}`, x: 370, width: 55, align: 'right' },
      { value: `$${product.price.toFixed(2)}`, x: 425, width: 55, align: 'right' },
      { value: product.inventoryValue === null ? 'Unavailable' : '$' + product.inventoryValue.toFixed(2), x: 480, width: 65, align: 'right' },
    ], i);
  });

  drawFooter(doc);
  doc.end();
});

/**
 * Get employee sales breakdown
 * GET /api/reports/employee-sales
 */
export const getEmployeeSalesBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  const { rows, ...meta } = await getEmployeeReportData(scope, req.query.startDate, req.query.endDate);
  res.json({ success: true, data: rows, ...meta });
});

/**
 * Inventory-log types that represent shrinkage (stock lost, not sold or moved).
 * Matches the reason list in the frontend StockAdjustmentModal.
 */
const SHRINKAGE_TYPES = ['DAMAGED', 'LOST', 'THEFT', 'EXPIRED', 'WASTE', 'OTHER'];

/**
 * Stock health report: dead stock, sell-through, and shrinkage over a window
 * GET /api/reports/stock-health?days=30
 */
export const getStockHealthReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || 30), 10) || 30, 7), 365);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const locationId = req.user?.locationId || undefined;
  const revenueStatuses = { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] };

  const [products, soldRows, lastSaleRows, shrinkLogs] = await Promise.all([
    // Active tracked catalog (misc pseudo-product excluded)
    prisma.product.findMany({
      where: {
        isActive: true,
        trackInventory: true,
        sku: { not: 'MISC-001' },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        cost: true,
        stockQuantity: true,
        category: { select: { id: true, name: true } },
      },
    }),
    // Units sold per product inside the window
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        createdAt: { gte: cutoff },
        sale: { status: revenueStatuses, ...(locationId ? { locationId } : {}) },
      },
      _sum: { quantity: true },
    }),
    // Most recent sale per product (all time) — shown for dead-stock rows
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: revenueStatuses, ...(locationId ? { locationId } : {}) } },
      _max: { createdAt: true },
    }),
    // Loss-reason stock removals inside the window
    prisma.inventoryLog.findMany({
      where: {
        type: { in: SHRINKAGE_TYPES },
        quantity: { lt: 0 },
        createdAt: { gte: cutoff },
        ...(locationId ? { product: { locationId } } : {}),
      },
      include: { product: { select: { name: true, sku: true, cost: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const soldMap = new Map(soldRows.map((r) => [r.productId, r._sum.quantity || 0]));
  const lastSaleMap = new Map(lastSaleRows.map((r) => [r.productId, r._max.createdAt]));
  const valuedProducts = await valueProducts(prisma, products);
  const lossEntries = shrinkLogs.length ? await prisma.$queryRaw<{ id: string; cogsAmount: Prisma.Decimal | null }[]>(Prisma.sql`
    SELECT id, "cogsAmount" FROM effective_inventory_values WHERE id IN (${Prisma.join(shrinkLogs.map(log => log.sourceId || ''))})`) : [];
  const lossCosts = new Map(lossEntries.map(entry => [entry.id, entry.cogsAmount === null ? null : Number(entry.cogsAmount)]));
  const lossCost = (log: typeof shrinkLogs[number]) => lossCosts.get(log.sourceId || '') ?? null;
  const sumKnown = (values: (number | null)[]) => values.some(value => value === null) ? null : rc(values.reduce<number>((sum, value) => sum + (value || 0), 0));

  // ---- Dead stock: on hand but zero sales in the window ----
  const deadStock = valuedProducts
    .filter((p) => p.stockQuantity > 0 && !soldMap.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryName: p.category?.name || 'Uncategorized',
      stockQuantity: p.stockQuantity,
      price: p.price,
      cost: p.cost,
      stockValue: p.inventoryValue === null ? null : rc(p.inventoryValue),
      retailValue: rc(Number(p.price) * p.stockQuantity),
      lastSoldAt: lastSaleMap.get(p.id) || null,
    }))
    .sort((a, b) => (b.stockValue || 0) - (a.stockValue || 0))
    .slice(0, 200);

  const deadStockTotals = {
    products: deadStock.length,
    units: deadStock.reduce((s, p) => s + p.stockQuantity, 0),
    stockValue: sumKnown(deadStock.map(p => p.stockValue)),
    retailValue: rc(deadStock.reduce((s, p) => s + p.retailValue, 0)),
  };

  // ---- Sell-through by category: sold / (sold + on hand) ----
  const byCategory = new Map<
    string,
    { categoryName: string; unitsSold: number; stockOnHand: number }
  >();
  for (const p of products) {
    const key = p.category?.id || 'uncategorized';
    const entry = byCategory.get(key) || {
      categoryName: p.category?.name || 'Uncategorized',
      unitsSold: 0,
      stockOnHand: 0,
    };
    entry.unitsSold += soldMap.get(p.id) || 0;
    entry.stockOnHand += p.stockQuantity;
    byCategory.set(key, entry);
  }
  const sellThrough = Array.from(byCategory.values())
    .filter((c) => c.unitsSold > 0 || c.stockOnHand > 0)
    .map((c) => ({
      ...c,
      sellThroughPct:
        c.unitsSold + c.stockOnHand > 0
          ? rc((c.unitsSold / (c.unitsSold + c.stockOnHand)) * 100)
          : 0,
    }))
    .sort((a, b) => b.sellThroughPct - a.sellThroughPct);

  const totalSold = sellThrough.reduce((s, c) => s + c.unitsSold, 0);
  const totalStock = sellThrough.reduce((s, c) => s + c.stockOnHand, 0);
  const sellThroughOverall =
    totalSold + totalStock > 0 ? rc((totalSold / (totalSold + totalStock)) * 100) : 0;

  // ---- Shrinkage grouped by reason ----
  const byReason = new Map<
    string,
    { reason: string; entries: number; units: number; costValue: number | null; retailValue: number }
  >();
  for (const log of shrinkLogs) {
    const units = Math.abs(log.quantity);
    const entry = byReason.get(log.type) || {
      reason: log.type,
      entries: 0,
      units: 0,
      costValue: 0,
      retailValue: 0,
    };
    entry.entries += 1;
    entry.units += units;
    entry.costValue = sumKnown([entry.costValue, lossCost(log)]);
    entry.retailValue += Number((log.product?.price || 0)) * units;
    byReason.set(log.type, entry);
  }
  const shrinkageByReason = Array.from(byReason.values())
    .map((r) => ({ ...r, retailValue: rc(r.retailValue) }))
    .sort((a, b) => (b.costValue || 0) - (a.costValue || 0));

  const shrinkageTotals = {
    entries: shrinkLogs.length,
    units: shrinkageByReason.reduce((s, r) => s + r.units, 0),
    costValue: sumKnown(shrinkageByReason.map(r => r.costValue)),
    retailValue: rc(shrinkageByReason.reduce((s, r) => s + r.retailValue, 0)),
  };

  const shrinkageRecent = shrinkLogs.slice(0, 25).map((log) => ({
    id: log.id,
    productName: log.product?.name || 'Unknown',
    sku: log.product?.sku || '',
    reason: log.type,
    units: Math.abs(log.quantity),
    costValue: lossCost(log),
    notes: log.notes,
    createdAt: log.createdAt,
  }));

  res.json({
    success: true,
    data: {
      days,
      deadStock: { totals: deadStockTotals, products: deadStock },
      sellThrough: { overallPct: sellThroughOverall, unitsSold: totalSold, stockOnHand: totalStock, byCategory: sellThrough },
      shrinkage: { totals: shrinkageTotals, byReason: shrinkageByReason, recent: shrinkageRecent },
    },
  });
});

/**
 * Send the end-of-day digest email now (also returns the narrative for preview)
 * POST /api/reports/daily-digest/send
 */
export const sendDailyDigestNow = asyncHandler(async (req: AuthRequest, res: Response) => {
  // Imported lazily so test runs don't construct the Anthropic client path eagerly
  const { sendDailyDigest } = await import('../services/dailyDigest.service');
  const scope = getLocationFilter(req, req.query.locationId as string);
  const { idempotencyKey } = z.object({ idempotencyKey: z.string().uuid() }).parse(req.body);
  const result = await sendDailyDigest(scope.locationId!, idempotencyKey);

  res.json({
    success: true,
    data: result,
    message:
      result.recipients.length > 0
        ? 'Digest queued. Check delivery history for provider status.'
        : 'No recipients configured — set DAILY_DIGEST_EMAILS or add admin users',
  });
});

/**
 * Age verification audit trail (compliance record for inspections)
 * GET /api/reports/age-verifications
 */
export const getAgeVerifications = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 25, startDate, endDate } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (req.user?.locationId) where.locationId = req.user.locationId;
  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) where.createdAt = dateFilter;

  const [logs, total] = await Promise.all([
    prisma.ageVerificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.ageVerificationLog.count({ where }),
  ]);

  // Resolve cashier names without a schema relation
  const userIds = [...new Set(logs.map((l) => l.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  res.json({
    success: true,
    data: logs.map((l) => ({ ...l, cashierName: userMap.get(l.userId) || 'Unknown' })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Tobacco / manufacturer scan-data export.
 *
 * Scan-data programs (Altria, RJR/ITG buydown reporting) pay retailers for
 * submitting weekly line-item sales of program categories. This produces the
 * generic wide-format CSV those portals ingest: one row per sold line item
 * with UPC, quantity, pricing, and promo attribution.
 *
 * GET /api/reports/scan-data/export/csv?startDate&endDate&categoryIds=a,b
 */
export const exportScanDataCSV = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { Parser } = require('json2csv');
  const { startDate, endDate, categoryIds } = req.query;

  const categoryFilter = parseListFilter(categoryIds);
  if (!categoryFilter) {
    res.status(400).json({ success: false, error: 'Select at least one category to export' });
    return;
  }

  const dateFilter = createDateFilter(startDate as string, endDate as string);

  const items = await prisma.saleItem.findMany({
    where: {
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      product: { categoryId: categoryFilter },
      sale: {
        status: { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] },
        ...(req.user?.locationId ? { locationId: req.user.locationId } : {}),
      },
    },
    include: {
      product: { select: { barcode: true, categoryId: true, category: { select: { name: true } } } },
      sale: {
        select: {
          saleNumber: true,
          createdAt: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const csvData = items.map((item) => {
    const dt = new Date(item.sale.createdAt);
    return {
      'Transaction Date': dt.toISOString().slice(0, 10),
      'Transaction Time': dt.toTimeString().slice(0, 8),
      'Store ID': item.sale.location?.id || '',
      'Store Name': item.sale.location?.name || '',
      'Transaction ID': item.sale.saleNumber,
      'UPC': item.product?.barcode || item.sku,
      'SKU': item.sku,
      'Item Description': item.productName,
      'Category': item.product?.category?.name || '',
      'Quantity': item.quantity,
      'Unit Price': item.price.toFixed(2),
      'Total Discount': item.discount.toFixed(2),
      'Promotion Flag': Number(item.promotionDiscount) > 0 ? 'Y' : 'N',
      'Promotion Name': item.promotionName || '',
      'Final Price': (Number(item.total) - Number(item.tax)).toFixed(2),
      'Tax': item.tax.toFixed(2),
    };
  });

  const parser = new Parser();
  const csv = parser.parse(
    csvData.length > 0
      ? csvData
      : [{ 'Transaction Date': '', 'Transaction Time': '', 'Store ID': '', 'Store Name': '', 'Transaction ID': '', 'UPC': '', 'SKU': '', 'Item Description': '', 'Category': '', 'Quantity': '', 'Unit Price': '', 'Total Discount': '', 'Promotion Flag': '', 'Promotion Name': '', 'Final Price': '', 'Tax': '' }]
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=scan-data-${startDate || 'all'}-${endDate || 'all'}.csv`
  );
  res.send(csv);
});

export const listDigestDeliveries = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  const { page } = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
  const [deliveries, total] = await prisma.$transaction([
    prisma.emailDelivery.findMany({ where: scope, select: deliverySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 25, skip: (page - 1) * 25 }),
    prisma.emailDelivery.count({ where: scope }),
  ]);
  res.json({ success: true, data: deliveries, pagination: { page, pages: Math.ceil(total / 25), total } });
});
export const retryDigestDelivery = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getLocationFilter(req, req.query.locationId as string);
  const input = z.object({ reason: z.string().trim().min(8).max(500), confirmedNotDelivered: z.boolean().default(false) }).parse(req.body);
  const delivery = await retryEmailDelivery(scope.locationId!, req.params.id, req.user!.id, input.reason, input.confirmedNotDelivered);
  res.json({ success: true, data: delivery, message: 'Delivery queued for retry' });
});
