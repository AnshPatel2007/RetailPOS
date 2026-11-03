import { getProfitAndLoss, exportSales } from '../controllers/financial.controller';
import prisma from '../config/database';
import { getSalesReportData } from '../services/salesReport.service';
jest.mock('../services/salesReport.service', () => ({ getSalesReportData: jest.fn() }));

jest.mock('../config/database', () => ({ __esModule: true, default: {
  $queryRaw: jest.fn(), $transaction: jest.fn(),
  location: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  sale: { aggregate: jest.fn(), findMany: jest.fn() },
  refund: { aggregate: jest.fn(), findMany: jest.fn() },
  expense: { groupBy: jest.fn() }, accountingExport: { create: jest.fn() },
} }));

beforeEach(() => {
  (prisma.location.findUnique as jest.Mock).mockResolvedValue({ timezone: 'UTC' });
  (prisma.location.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'store', name: 'Store' });
  (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(prisma));
});

test('P&L counts a fully refunded sale once and its refund once', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ collected: 100, tax: 0, refunds: 100, refundTax: 0, cost: 60, returnedCost: 60 }]);
  (prisma.expense.groupBy as jest.Mock).mockResolvedValue([]);
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getProfitAndLoss({ query: {}, user: { id: 'manager', role: 'MANAGER', locationId: 'store' } } as any, res as any, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revenue: expect.objectContaining({ grossSales: 100, refunds: 100, netSales: 0 }), netIncome: 0 }) }));
});

test('accounting export retains both the sale and full refund entries', async () => {
  (getSalesReportData as jest.Mock).mockResolvedValue({ entries: [
    { id: 'sale', kind: 'SALE', total: 100, tax: 0, saleNumber: 'sale', createdAt: new Date('2026-01-01'), customer: 'Walk-in', method: 'CASH' },
    { id: 'refund', kind: 'REFUND', total: -100, tax: 0, saleNumber: 'sale', createdAt: new Date('2026-01-02'), customer: 'Walk-in', method: 'CASH' },
  ], summary: { totalSales: 0, totalTax: 0, netSales: 0, voids: 0 } });
  (prisma.accountingExport.create as jest.Mock).mockResolvedValue({});
  const res = { json: jest.fn() };
  const next = jest.fn();
  await exportSales({ query: {}, user: { id: 'manager', role: 'MANAGER', locationId: 'store' } } as any, res as any, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recordCount: 2, totalRevenue: 0 }) }));
});
