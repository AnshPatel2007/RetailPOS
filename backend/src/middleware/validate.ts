import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { AppError } from '../utils/errorHandler';

/**
 * Validation middleware using Zod schemas
 */
export const validate = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      // Controllers must receive the validated fields, not the original object
      // containing arbitrary Prisma fields or nested relation writes.
      if (Object.prototype.hasOwnProperty.call(parsed, 'body')) req.body = parsed.body;
      if (Object.prototype.hasOwnProperty.call(parsed, 'query')) req.query = parsed.query;
      if (Object.prototype.hasOwnProperty.call(parsed, 'params')) req.params = parsed.params;

      return next(); // ✅ FIXED: always return
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          error: errors.map(err => err.message).join('; '),
          errors,
        }); // already returned
      }

      return next(new AppError('Validation error', 400)); // ✅ FIXED: return the next()
    }
  };
};
