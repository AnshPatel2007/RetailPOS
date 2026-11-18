import { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { authenticate, requireCapability } from '../middleware/auth';
import { AuthRequest } from '../types';
import { AppError, asyncHandler } from '../utils/errorHandler';
import { MAX_INVOICE_FILES, MAX_PDF_BYTES } from '../services/invoiceReading.service';
import {
  createDeliveryInvoice, deliveryInvoicePage, discardDeliveryInvoice, getDeliveryInvoice, listDeliveryInvoices,
  readDeliveryInvoiceAgain, updateDeliveryInvoice,
} from '../services/deliveryInvoice.service';
import { receiveDeliveryInvoice } from '../services/deliveryInvoiceReceiving.service';

/**
 * Delivery invoices (see services/deliveryInvoice.service.ts). Anyone working
 * in the store may send one; owners and managers check and receive them.
 */
const router = Router();
router.use(authenticate);

// Each read is a paid AI call of up to a few minutes: a few per person at a time.
const readingLimiter = rateLimit({
  windowMs: 10 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => (req as AuthRequest).user!.id,
  message: { success: false, error: 'Please wait a few minutes before sending more invoices.' },
  skip: () => config.nodeEnv === 'test',
});

const pagesUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: MAX_INVOICE_FILES, fields: 4, fieldSize: 1024 * 1024 } })
  .array('pages', MAX_INVOICE_FILES);
const receivePages = (req: AuthRequest, res: Response, next: NextFunction) => pagesUpload(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be under 5 MB, and a PDF under 15 MB'
      : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE' ? `Send up to ${MAX_INVOICE_FILES} photos at a time` : 'The photos could not be received. Try again.';
    return next(new AppError(message, 400));
  }
  return next(error);
});

router.post('/', requireCapability('checkout.complete'), readingLimiter, receivePages, asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = (Array.isArray(req.files) ? req.files : []).map(file => ({ buffer: file.buffer, size: file.size }));
  res.status(201).json({ success: true, data: await createDeliveryInvoice(req, files) });
}));
router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await listDeliveryInvoices(req) })));
router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await getDeliveryInvoice(req, req.params.id) })));
router.get('/:id/pages/:page', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = await deliveryInvoicePage(req, req.params.id, req.params.page);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(page.mimeType).sendFile(page.path, error => {
    if (error && !res.headersSent) res.status(404).json({ success: false, error: 'Invoice photo not found' });
  });
}));
router.patch('/:id', requireCapability('inventory.manage'), asyncHandler(async (req: AuthRequest, res: Response) =>
  res.json({ success: true, data: await updateDeliveryInvoice(req, req.params.id) })));
router.post('/:id/read', requireCapability('checkout.complete'), readingLimiter, asyncHandler(async (req: AuthRequest, res: Response) =>
  res.json({ success: true, data: await readDeliveryInvoiceAgain(req, req.params.id) })));
// The owner's OK: stock and costs arrive through the reviewed receipt import.
router.post('/:id/receive', requireCapability('inventory.manage'), asyncHandler(async (req: AuthRequest, res: Response) =>
  res.json({ success: true, data: await receiveDeliveryInvoice(req, req.params.id) })));
router.post('/:id/discard', requireCapability('checkout.complete'), asyncHandler(async (req: AuthRequest, res: Response) =>
  res.json({ success: true, data: await discardDeliveryInvoice(req, req.params.id) })));

export default router;
