import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { getLocationFilter } from '../utils/locationFilter.util';

/**
 * LOTTERY TICKET TYPE CONTROLLERS
 */

// Get all ticket types
export const getTicketTypes = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isActive, locationId } = req.query;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const ticketTypes = await prisma.lotteryTicketType.findMany({
    where,
    orderBy: [
      { sortOrder: 'asc' },
      { ticketName: 'asc' },
    ],
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          dailyEntries: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: ticketTypes,
  });
});

// Get single ticket type
export const getTicketTypeById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const ticketType = await prisma.lotteryTicketType.findUnique({
    where: { id },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          dailyEntries: true,
        },
      },
    },
  });

  if (!ticketType) {
    throw new AppError('Ticket type not found', 404);
  }

  res.json({
    success: true,
    data: ticketType,
  });
});

// Create ticket type
export const createTicketType = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticketName, ticketCode, pricePerTicket, sortOrder } = req.body;

  if (!req.user || !req.user.locationId) {
    throw new AppError('User location not found', 400);
  }

  // Check if ticket code already exists for this location
  const existing = await prisma.lotteryTicketType.findFirst({
    where: {
      ticketCode,
      locationId: req.user.locationId,
    },
  });

  if (existing) {
    throw new AppError('Ticket code already exists for this location', 400);
  }

  const ticketType = await prisma.lotteryTicketType.create({
    data: {
      ticketName,
      ticketCode,
      pricePerTicket,
      sortOrder: sortOrder || 0,
      locationId: req.user.locationId,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CREATE',
      entity: 'LOTTERY_TICKET_TYPE',
      entityId: ticketType.id,
      details: { ticketName, ticketCode, pricePerTicket },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery ticket type created: ${ticketName} by user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: ticketType,
    message: 'Ticket type created successfully',
  });
});

// Update ticket type
export const updateTicketType = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  const ticketType = await prisma.lotteryTicketType.findUnique({
    where: { id },
  });

  if (!ticketType) {
    throw new AppError('Ticket type not found', 404);
  }

  // If updating ticketCode, check for duplicates
  if (updates.ticketCode && updates.ticketCode !== ticketType.ticketCode) {
    const existing = await prisma.lotteryTicketType.findFirst({
      where: {
        ticketCode: updates.ticketCode,
        locationId: ticketType.locationId,
        id: { not: id },
      },
    });

    if (existing) {
      throw new AppError('Ticket code already exists for this location', 400);
    }
  }

  const updated = await prisma.lotteryTicketType.update({
    where: { id },
    data: updates,
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE',
        entity: 'LOTTERY_TICKET_TYPE',
        entityId: updated.id,
        details: updates,
        locationId: req.user.locationId,
      },
    });
  }

  logger.info(`Lottery ticket type updated: ${id} by user ${req.user?.id}`);

  res.json({
    success: true,
    data: updated,
    message: 'Ticket type updated successfully',
  });
});

// Delete ticket type
export const deleteTicketType = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const ticketType = await prisma.lotteryTicketType.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          dailyEntries: true,
        },
      },
    },
  });

  if (!ticketType) {
    throw new AppError('Ticket type not found', 404);
  }

  if (ticketType._count.dailyEntries > 0) {
    throw new AppError('Cannot delete ticket type with existing daily entries. Deactivate instead.', 400);
  }

  await prisma.lotteryTicketType.delete({
    where: { id },
  });

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE',
        entity: 'LOTTERY_TICKET_TYPE',
        entityId: id,
        details: { ticketName: ticketType.ticketName },
        locationId: req.user.locationId,
      },
    });
  }

  logger.info(`Lottery ticket type deleted: ${id} by user ${req.user?.id}`);

  res.json({
    success: true,
    message: 'Ticket type deleted successfully',
  });
});

/**
 * LOTTERY DAILY ENTRY CONTROLLERS
 */

// Get daily entries
export const getDailyEntries = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryDate, startDate, endDate, ticketTypeId, locationId } = req.query;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  const where: any = {};

  if (locationFilter.locationId) {
    where.locationId = locationFilter.locationId;
  }

  if (entryDate) {
    // Parse the date and set time to start/end of day
    const date = new Date(entryDate as string);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));
    where.entryDate = {
      gte: startOfDay,
      lte: endOfDay,
    };
  } else if (startDate && endDate) {
    where.entryDate = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  if (ticketTypeId) {
    where.ticketTypeId = ticketTypeId;
  }

  const entries = await prisma.lotteryDailyEntry.findMany({
    where,
    orderBy: [
      { entryDate: 'desc' },
      { ticketType: { sortOrder: 'asc' } },
    ],
    include: {
      ticketType: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      creator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      editor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: entries,
  });
});

// Get previous day's ending number for carry-forward
const getPreviousDayEndingNumber = async (
  ticketTypeId: string,
  entryDate: Date,
  locationId: string
): Promise<number | null> => {
  // Get the previous day
  const previousDate = new Date(entryDate);
  previousDate.setDate(previousDate.getDate() - 1);
  const startOfPrevDay = new Date(previousDate.setHours(0, 0, 0, 0));
  const endOfPrevDay = new Date(previousDate.setHours(23, 59, 59, 999));

  const previousEntry = await prisma.lotteryDailyEntry.findFirst({
    where: {
      ticketTypeId,
      locationId,
      entryDate: {
        gte: startOfPrevDay,
        lte: endOfPrevDay,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return previousEntry?.endNumber || null;
};

// Create daily entry
export const createDailyEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryDate, ticketTypeId, startNumber, endNumber, notes } = req.body;

  if (!req.user || !req.user.locationId) {
    throw new AppError('User location not found', 400);
  }

  // Verify ticket type exists and belongs to this location
  const ticketType = await prisma.lotteryTicketType.findFirst({
    where: {
      id: ticketTypeId,
      locationId: req.user.locationId,
    },
  });

  if (!ticketType) {
    throw new AppError('Ticket type not found', 404);
  }

  // Parse entry date
  const parsedDate = new Date(entryDate);
  const startOfDay = new Date(parsedDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(parsedDate.setHours(23, 59, 59, 999));

  // Check if entry already exists for this date and ticket type
  const existing = await prisma.lotteryDailyEntry.findFirst({
    where: {
      ticketTypeId,
      locationId: req.user.locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (existing) {
    throw new AppError('Entry already exists for this date and ticket type', 400);
  }

  // Auto-calculate fields
  const ticketsSold = endNumber - startNumber;
  const totalSales = ticketsSold * ticketType.pricePerTicket;

  const entry = await prisma.lotteryDailyEntry.create({
    data: {
      entryDate: startOfDay,
      ticketTypeId,
      locationId: req.user.locationId,
      startNumber,
      endNumber,
      pricePerTicket: ticketType.pricePerTicket,
      ticketsSold,
      totalSales,
      notes,
      createdBy: req.user.id,
    },
    include: {
      ticketType: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      creator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Update day status
  await updateDayStatus(req.user.locationId, startOfDay);

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CREATE',
      entity: 'LOTTERY_DAILY_ENTRY',
      entityId: entry.id,
      details: { ticketType: ticketType.ticketName, ticketsSold, totalSales },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery daily entry created for ${ticketType.ticketName} by user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: entry,
    message: 'Daily entry created successfully',
  });
});

// Update daily entry
export const updateDailyEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { startNumber, endNumber, notes } = req.body;

  const entry = await prisma.lotteryDailyEntry.findUnique({
    where: { id },
    include: {
      ticketType: true,
    },
  });

  if (!entry) {
    throw new AppError('Daily entry not found', 404);
  }

  // Check if day is closed
  const startOfDay = new Date(entry.entryDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(entry.entryDate);
  endOfDay.setHours(23, 59, 59, 999);

  const dayStatus = await prisma.lotteryDayStatus.findFirst({
    where: {
      locationId: entry.locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (dayStatus?.isClosed) {
    throw new AppError('Cannot update entry for a closed day', 400);
  }

  const updateData: any = {};

  if (startNumber !== undefined) {
    updateData.startNumber = startNumber;
  }

  if (endNumber !== undefined) {
    updateData.endNumber = endNumber;
  }

  if (notes !== undefined) {
    updateData.notes = notes;
  }

  // Recalculate if numbers changed
  const finalStartNumber = startNumber !== undefined ? startNumber : entry.startNumber;
  const finalEndNumber = endNumber !== undefined ? endNumber : entry.endNumber;

  if (startNumber !== undefined || endNumber !== undefined) {
    const ticketsSold = finalEndNumber - finalStartNumber;
    const totalSales = ticketsSold * entry.ticketType.pricePerTicket;
    updateData.ticketsSold = ticketsSold;
    updateData.totalSales = totalSales;
  }

  if (req.user) {
    updateData.updatedBy = req.user.id;
  }

  const updated = await prisma.lotteryDailyEntry.update({
    where: { id },
    data: updateData,
    include: {
      ticketType: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      creator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      editor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Update day status
  await updateDayStatus(entry.locationId, startOfDay);

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE',
        entity: 'LOTTERY_DAILY_ENTRY',
        entityId: updated.id,
        details: updateData,
        locationId: req.user.locationId,
      },
    });
  }

  logger.info(`Lottery daily entry updated: ${id} by user ${req.user?.id}`);

  res.json({
    success: true,
    data: updated,
    message: 'Daily entry updated successfully',
  });
});

// Delete daily entry
export const deleteDailyEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const entry = await prisma.lotteryDailyEntry.findUnique({
    where: { id },
  });

  if (!entry) {
    throw new AppError('Daily entry not found', 404);
  }

  // Check if day is closed
  const startOfDay = new Date(entry.entryDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(entry.entryDate);
  endOfDay.setHours(23, 59, 59, 999);

  const dayStatus = await prisma.lotteryDayStatus.findFirst({
    where: {
      locationId: entry.locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (dayStatus?.isClosed) {
    throw new AppError('Cannot delete entry for a closed day', 400);
  }

  await prisma.lotteryDailyEntry.delete({
    where: { id },
  });

  // Update day status
  await updateDayStatus(entry.locationId, startOfDay);

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE',
        entity: 'LOTTERY_DAILY_ENTRY',
        entityId: id,
        details: {},
        locationId: req.user.locationId,
      },
    });
  }

  logger.info(`Lottery daily entry deleted: ${id} by user ${req.user?.id}`);

  res.json({
    success: true,
    message: 'Daily entry deleted successfully',
  });
});

/**
 * LOTTERY DAY STATUS CONTROLLERS
 */

// Helper function to update day status totals
async function updateDayStatus(locationId: string, entryDate: Date) {
  const startOfDay = new Date(entryDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(entryDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Get all entries for this day
  const entries = await prisma.lotteryDailyEntry.findMany({
    where: {
      locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  // Calculate totals
  const totalTicketsSold = entries.reduce((sum, entry) => sum + entry.ticketsSold, 0);
  const totalSales = entries.reduce((sum, entry) => sum + entry.totalSales, 0);

  // Get or create day status
  const existingStatus = await prisma.lotteryDayStatus.findFirst({
    where: {
      locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  const manualCashoutAmount = existingStatus?.manualCashoutAmount || 0;
  const netAmount = totalSales - manualCashoutAmount;

  if (existingStatus) {
    await prisma.lotteryDayStatus.update({
      where: { id: existingStatus.id },
      data: {
        totalTicketsSold,
        totalSales,
        netAmount,
      },
    });
  } else {
    await prisma.lotteryDayStatus.create({
      data: {
        entryDate: startOfDay,
        locationId,
        totalTicketsSold,
        totalSales,
        manualCashoutAmount: 0,
        netAmount,
        status: 'OPEN',
        isClosed: false,
      },
    });
  }
}

// Get day status
export const getDayStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryDate, locationId } = req.query;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  if (!entryDate) {
    throw new AppError('Entry date is required', 400);
  }

  const date = new Date(entryDate as string);
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  const dayStatus = await prisma.lotteryDayStatus.findFirst({
    where: {
      locationId: locationFilter.locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      closedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      reopenedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!dayStatus) {
    // Return default status
    return res.json({
      success: true,
      data: {
        entryDate: startOfDay,
        locationId: locationFilter.locationId,
        totalTicketsSold: 0,
        totalSales: 0,
        manualCashoutAmount: 0,
        netAmount: 0,
        status: 'OPEN',
        isClosed: false,
      },
    });
  }

  return res.json({
    success: true,
    data: dayStatus,
  });
});

// Update day status (cashout amount)
export const updateDayStatusCashout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { manualCashoutAmount, notes } = req.body;

  const dayStatus = await prisma.lotteryDayStatus.findUnique({
    where: { id },
  });

  if (!dayStatus) {
    throw new AppError('Day status not found', 404);
  }

  if (dayStatus.isClosed) {
    throw new AppError('Cannot update a closed day', 400);
  }

  const netAmount = dayStatus.totalSales - (manualCashoutAmount || dayStatus.manualCashoutAmount);

  const updated = await prisma.lotteryDayStatus.update({
    where: { id },
    data: {
      manualCashoutAmount: manualCashoutAmount !== undefined ? manualCashoutAmount : dayStatus.manualCashoutAmount,
      netAmount,
      notes: notes !== undefined ? notes : dayStatus.notes,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (req.user) {
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE',
        entity: 'LOTTERY_DAY_STATUS',
        entityId: updated.id,
        details: { manualCashoutAmount, netAmount },
        locationId: req.user.locationId,
      },
    });
  }

  return res.json({
    success: true,
    data: updated,
    message: 'Day status updated successfully',
  });
});

// Close day
export const closeDay = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryDate, manualCashoutAmount, notes } = req.body;

  if (!req.user || !req.user.locationId) {
    throw new AppError('User location not found', 400);
  }

  const date = new Date(entryDate);
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  let dayStatus = await prisma.lotteryDayStatus.findFirst({
    where: {
      locationId: req.user.locationId,
      entryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (!dayStatus) {
    // Create initial status if it doesn't exist
    await updateDayStatus(req.user.locationId, startOfDay);

    dayStatus = await prisma.lotteryDayStatus.findFirst({
      where: {
        locationId: req.user.locationId,
        entryDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });
  }

  if (!dayStatus) {
    throw new AppError('Day status not found', 404);
  }

  if (dayStatus.isClosed) {
    throw new AppError('Day is already closed', 400);
  }

  const netAmount = dayStatus.totalSales - manualCashoutAmount;

  const updated = await prisma.lotteryDayStatus.update({
    where: { id: dayStatus.id },
    data: {
      manualCashoutAmount,
      netAmount,
      notes,
      status: 'CLOSED',
      isClosed: true,
      closedAt: new Date(),
      closedBy: req.user.id,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      closedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CLOSE',
      entity: 'LOTTERY_DAY_STATUS',
      entityId: updated.id,
      details: { entryDate: startOfDay, totalSales: dayStatus.totalSales, netAmount },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery day closed for ${startOfDay.toDateString()} by user ${req.user.id}`);

  res.json({
    success: true,
    data: updated,
    message: 'Day closed successfully',
  });
});

// Reopen day (Admin only)
export const reopenDay = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Check if user is admin
  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    throw new AppError('Only admins can reopen days', 403);
  }

  const dayStatus = await prisma.lotteryDayStatus.findUnique({
    where: { id },
  });

  if (!dayStatus) {
    throw new AppError('Day status not found', 404);
  }

  if (!dayStatus.isClosed) {
    throw new AppError('Day is not closed', 400);
  }

  const updated = await prisma.lotteryDayStatus.update({
    where: { id },
    data: {
      status: 'OPEN',
      isClosed: false,
      reopenedAt: new Date(),
      reopenedBy: req.user.id,
      notes: notes !== undefined ? notes : dayStatus.notes,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      reopenedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'REOPEN',
      entity: 'LOTTERY_DAY_STATUS',
      entityId: updated.id,
      details: { entryDate: dayStatus.entryDate },
      locationId: req.user.locationId,
    },
  });

  logger.info(`Lottery day reopened for ${dayStatus.entryDate.toDateString()} by user ${req.user.id}`);

  res.json({
    success: true,
    data: updated,
    message: 'Day reopened successfully',
  });
});

// Get carry-forward info for next day
export const getCarryForwardInfo = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { entryDate, locationId } = req.query;

  const locationFilter = getLocationFilter(req, locationId as string | undefined);

  if (!entryDate) {
    throw new AppError('Entry date is required', 400);
  }

  if (!locationFilter.locationId) {
    throw new AppError('Location is required', 400);
  }

  // Get all ticket types for this location
  const ticketTypes = await prisma.lotteryTicketType.findMany({
    where: {
      locationId: locationFilter.locationId,
      isActive: true,
    },
    orderBy: [{ sortOrder: 'asc' }],
  });

  const carryForwardData = await Promise.all(
    ticketTypes.map(async (ticketType) => {
      const previousEndNumber = await getPreviousDayEndingNumber(
        ticketType.id,
        new Date(entryDate as string),
        locationFilter.locationId as string
      );

      return {
        ticketTypeId: ticketType.id,
        ticketName: ticketType.ticketName,
        ticketCode: ticketType.ticketCode,
        pricePerTicket: ticketType.pricePerTicket,
        suggestedStartNumber: previousEndNumber,
      };
    })
  );

  res.json({
    success: true,
    data: carryForwardData,
  });
});
