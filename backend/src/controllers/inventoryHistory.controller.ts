import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler } from '../utils/errorHandler';
import { getLocationFilter } from '../utils/locationFilter.util';
import { getReportRange } from '../services/reportDates.service';

export const getInventoryHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(200).optional(), productId: z.string().max(100).optional(), type: z.string().max(50).optional(), startDate: z.string().optional(), endDate: z.string().optional() }).parse(req.query);
  const scope = getLocationFilter(req, req.query.locationId as string);
  const period = await getReportRange(scope, query.startDate, query.endDate);
  // Unassigned legacy movements require ownership review; never infer sharing from a connection.
  const where: Prisma.InventoryLogWhereInput = { locationId: scope.locationId || { not: null },
    ...(query.productId ? { productId: query.productId } : {}), ...(query.type ? { type: query.type } : {}), createdAt: period.range,
    ...(query.search ? { OR: [{ product: { name: { contains: query.search, mode: 'insensitive' } } }, { product: { sku: { contains: query.search, mode: 'insensitive' } } }, { sourceId: { contains: query.search, mode: 'insensitive' } }] } : {}) };
  const result = await prisma.$transaction(async tx => {
    const [rows, total] = await Promise.all([
      tx.inventoryLog.findMany({ where, select: { id: true, type: true, quantity: true, previousQty: true, newQty: true, sourceId: true, notes: true, stockVersion: true, createdAt: true, userId: true, product: { select: { id: true, name: true, sku: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: (query.page - 1) * query.limit }),
      tx.inventoryLog.count({ where }),
    ]);
    const users = await tx.user.findMany({ where: { id: { in: rows.flatMap(row => row.userId ? [row.userId] : []) } }, select: { id: true, firstName: true, lastName: true } });
    const names = new Map(users.map(user => [user.id, user.firstName + ' ' + user.lastName]));
    return { rows: rows.map(row => ({ ...row, actor: row.userId ? names.get(row.userId) || 'Former employee' : 'System' })), total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  res.json({ success: true, data: result.rows, timezone: period.timezone,
    pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } });
});
