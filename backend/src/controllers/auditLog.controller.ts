import { Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { parseStartDate, parseEndDate } from '../utils/dateFilter.util';
import { getLocationFilter } from '../utils/locationFilter.util';

/**
 * Get audit logs with filtering, pagination, and search
 */
export const getAuditLogs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = '1',
    limit = '50',
    action,
    entity,
    userId,
    startDate,
    endDate,
    search,
    locationId,
  } = req.query as Record<string, string>;

  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 50, 200);
  const skip = (pageNum - 1) * limitNum;

  const where: any = { ...getLocationFilter(req, locationId) };

  if (action) {
    where.action = action;
  }
  if (entity) {
    where.entity = entity;
  }
  if (userId) {
    where.userId = userId;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = parseStartDate(startDate);
    if (endDate) where.createdAt.lte = parseEndDate(endDate);
  }
  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { entity: { contains: search, mode: 'insensitive' } },
      { entityId: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
    }),
    prisma.activityLog.count({ where }),
  ]);

  res.json({
    success: true,
    data: logs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get distinct action types for filter dropdown
 */
export const getAuditActions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const actions = await prisma.activityLog.findMany({
    where: { ...getLocationFilter(req) },
    select: { action: true },
    distinct: ['action'],
    orderBy: { action: 'asc' },
  });

  res.json({
    success: true,
    data: actions.map((a) => a.action),
  });
});

/**
 * Get distinct entity types for filter dropdown
 */
export const getAuditEntities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const entities = await prisma.activityLog.findMany({
    select: { entity: true },
    distinct: ['entity'],
    where: { entity: { not: null }, ...getLocationFilter(req) },
    orderBy: { entity: 'asc' },
  });

  res.json({
    success: true,
    data: entities.map((e) => e.entity).filter(Boolean),
  });
});
