import { z } from 'zod';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const promotionBody = z
  .object({
    name: z.string().min(1, 'Name is required').max(120),
    description: z.string().max(500).optional().nullable(),
    type: z.enum(['QUANTITY_PRICE', 'BOGO', 'PERCENT_OFF', 'AMOUNT_OFF']),
    isActive: z.boolean().optional(),
    buyQuantity: z.number().int().min(1).optional().nullable(),
    getQuantity: z.number().int().min(1).optional().nullable(),
    bundlePrice: z.number().min(0).optional().nullable(),
    percentOff: z.number().gt(0).max(100).optional().nullable(),
    amountOff: z.number().gt(0).optional().nullable(),
    productIds: z.array(z.string().min(1)).max(200).optional(),
    categoryIds: z.array(z.string().min(1)).max(100).optional(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startTime: z.string().regex(timePattern, 'Use HH:MM (24h)').optional().nullable(),
    endTime: z.string().regex(timePattern, 'Use HH:MM (24h)').optional().nullable(),
    locationId: z.string().min(1).optional().nullable(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    const require = (field: keyof typeof data, message: string) => {
      if (data[field] === undefined || data[field] === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field as string], message });
      }
    };
    switch (data.type) {
      case 'QUANTITY_PRICE':
        require('buyQuantity', 'Bundle size is required (e.g. 2 for "2 for $6")');
        require('bundlePrice', 'Bundle price is required');
        break;
      case 'BOGO':
        require('buyQuantity', 'Paid quantity is required (the "buy N")');
        require('getQuantity', 'Discounted quantity is required (the "get M")');
        break;
      case 'PERCENT_OFF':
        require('percentOff', 'Percent off is required');
        break;
      case 'AMOUNT_OFF':
        require('amountOff', 'Amount off is required');
        break;
    }
    if ((data.productIds?.length ?? 0) === 0 && (data.categoryIds?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productIds'],
        message: 'Select at least one product or category',
      });
    }
    if ((data.startTime && !data.endTime) || (!data.startTime && data.endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startTime'],
        message: 'Provide both a start and end time, or neither',
      });
    }
    if (data.startsAt && data.endsAt && new Date(data.startsAt) > new Date(data.endsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'End date must be after the start date',
      });
    }
  });

export const createPromotionSchema = z.object({ body: promotionBody });

// Updates send the full promotion shape (the form always submits every field)
export const updatePromotionSchema = z.object({ body: promotionBody });
