import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodTypeAny } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';

interface RequestValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export const validate = (schemas: RequestValidationSchema): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as Record<string, string>;
      }
      if (schemas.query) {
        const parsedQuery = (await schemas.query.parseAsync(req.query)) as Record<string, unknown>;
        req.query = parsedQuery as unknown as typeof req.query;
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to validate that a given URL route param is a valid MongoDB ObjectId.
 * Throws AppError.badRequest (400) on invalid IDs.
 */
export const validateObjectId = (paramName: string = 'id'): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.params[paramName];
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest(`Invalid ObjectId format for parameter '${paramName}'`);
    }
    next();
  };
};
