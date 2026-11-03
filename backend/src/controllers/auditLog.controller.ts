import { Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getReportRange } from '../services/reportDates.service';
import { auditScope, auditDetails } from '../services/auditPolicy.service';

/**
 * Get audit logs with filtering, pagination, and search
 */
export const getAuditLogs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(200).default(50),
    action: z.string().max(100).optional(), entity: z.string().max(100).optional(), userId: z.string().max(100).optional(),
    startDate: z.string().optional(), endDate: z.string().optional(), search: z.string().trim().max(200).optional(),
  }).parse(req.query);
  const scope = auditScope(req);
  const calendarScope = { locationId: typeof scope.locationId === 'string' ? scope.locationId : undefined };
  const period = await getReportRange(calendarScope, query.startDate, query.endDate);
  const where: Prisma.ActivityLogWhereInput = { AND: [scope, {
    ...(query.action ? { action: query.action } : {}), ...(query.entity ? { entity: query.entity } : {}),
    ...(query.userId ? { userId: query.userId } : {}), createdAt: period.range,
    ...(query.search ? { OR: ['action', 'entity', 'entityId'].map(field => ({ [field]: { contains: query.search, mode: 'insensitive' } })) } : {}),
  }] };
  const [logs, total] = await prisma.$transaction([
    prisma.activityLog.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.activityLog.count({ where }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  res.json({ success: true, data: logs.map(log => ({ ...log, details: auditDetails(log.details, req.user?.role === 'ADMIN') })),
    timezone: period.timezone, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } });
});

export const getAuditActions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const actions = await prisma.activityLog.findMany({ where: auditScope(req), select: { action: true }, distinct: ['action'], orderBy: { action: 'asc' } });
  res.json({ success: true, data: actions.map(row => row.action) });
});

export const getAuditEntities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const entities = await prisma.activityLog.findMany({ where: { AND: [auditScope(req), { entity: { not: null } }] }, select: { entity: true }, distinct: ['entity'], orderBy: { entity: 'asc' } });
  res.json({ success: true, data: entities.map(row => row.entity) });
});
