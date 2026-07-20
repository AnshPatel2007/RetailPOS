import { z } from 'zod';

export const createCustomerSchema = z.object({
  body: z.object({
    email: z.union([z.string().email(), z.literal('')]).optional(),
    phone: z.string().min(1, 'Phone number is required'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    emailMarketing: z.boolean().optional(),
    smsMarketing: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    birthDate: z.string().optional().nullable(), // yyyy-mm-dd
    notes: z.string().optional(),
  }),
});

export const updateCustomerSchema = z.object({
  body: z.object({
    email: z.union([z.string().email(), z.literal('')]).optional().nullable(),
    phone: z.string().optional().nullable(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    zipCode: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    emailMarketing: z.boolean().optional(),
    smsMarketing: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    birthDate: z.string().optional().nullable(), // yyyy-mm-dd
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    loyaltyPoints: z.number().int().min(0).optional(),
  }),
});
