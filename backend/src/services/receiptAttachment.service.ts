import fs from 'fs/promises';
import path from 'path';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord, resolveWriteLocation } from '../utils/locationFilter.util';

export const receiptDirectory = path.resolve(__dirname, '../../uploads/receipts');

export function receiptFilename(url: string): string {
  const match = /^\/(?:api\/expenses\/receipts|uploads\/receipts)\/([^/\\?#]+)$/.exec(url);
  if (!match || match[1].includes('..')) throw new AppError('Choose an uploaded receipt', 400);
  return match[1];
}

export function detectReceiptType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif';
  return null;
}

export async function assertReceiptAccess(req: AuthRequest, url: string): Promise<string> {
  const filename = receiptFilename(url);
  const attachment = await prisma.receiptAttachment.findUnique({ where: { filename } });
  if (attachment) {
    assertOwnsRecord(req, attachment.locationId);
    // Once linked, the financial record's privacy rules also apply.
    const payroll = await prisma.expense.count({ where: { receiptUrl: { in: [url, `/uploads/receipts/${filename}`, `/api/expenses/receipts/${filename}`] }, category: 'PAYROLL' } });
    if (payroll && req.user?.role !== 'ADMIN') throw new AppError('Payroll records are owner-only', 403);
  } else {
    // Legacy files need an associated, owned record. Orphan files remain private.
    const expenses = await prisma.expense.findMany({ where: { receiptUrl: { in: [`/uploads/receipts/${filename}`, `/api/expenses/receipts/${filename}`] } }, select: { locationId: true, category: true } });
    if (!expenses.length) throw new AppError('Receipt not found', 404);
    for (const expense of expenses) {
      assertOwnsRecord(req, expense.locationId);
      if (expense.category === 'PAYROLL' && req.user?.role !== 'ADMIN') throw new AppError('Payroll records are owner-only', 403);
    }
  }
  return filename;
}

export async function saveReceipt(req: AuthRequest, file: Express.Multer.File) {
  try {
    const locationId = resolveWriteLocation(req, req.body.locationId);
    const bytes = await fs.readFile(file.path);
    const mimeType = detectReceiptType(bytes);
    if (!mimeType || mimeType !== file.mimetype.replace('image/jpg', 'image/jpeg')) throw new AppError('Receipt contents do not match its file type', 400);
    await prisma.receiptAttachment.create({ data: { filename: file.filename, locationId, userId: req.user!.id, mimeType, size: file.size } });
    return `/api/expenses/receipts/${file.filename}`;
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined);
    throw error;
  }
}
