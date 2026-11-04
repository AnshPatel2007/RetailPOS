import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** Optional machine-readable context returned with the message (e.g. what a duplicate barcode belongs to). */
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number = 500, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error('Error occurred:', err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Prisma errors
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, error: 'Upload failed. Choose one receipt file up to 5 MB.' });
  }
  if (err.name === 'PrismaClientKnownRequestError') {
    return res.status(400).json({
      success: false,
      error: 'Database operation failed',
      // A client must not replace an uncertain financial request with a new key.
      // Preserve the existing status contract until database errors are classified.
      retrySameRequest: true,
    });
  }

  // Validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err,
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Return the promise so callers (and tests) can await handler completion;
    // Express ignores the return value.
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};
