import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import { env } from '../config/env';

interface ErrorEnvelope {
  success: false;
  message: string;
  requestId?: string;
  errors?: unknown;
  stack?: string;
}

export const errorHandler: ErrorRequestHandler = (
  err: Error | AppError | unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let errors: unknown = undefined;

  // 1. Zod validation error -> 422
  if (err instanceof ZodError) {
    statusCode = 422;
    message = 'Validation failed';
    errors = err.issues.map((issue) => ({
      field: issue.path.join('.') || 'root',
      message: issue.message,
    }));
  }
  // 2. body-parser errors (entity.parse.failed -> 400, entity.too.large -> 413)
  else if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof (err as { type: unknown }).type === 'string' &&
    !(err instanceof AppError) &&
    !(err instanceof ZodError)
  ) {
    const bpErr = err as { type: string; status: number; message?: string };
    if (bpErr.type === 'entity.parse.failed') {
      statusCode = 400;
      message = 'Malformed JSON body';
    } else if (bpErr.status === 413) {
      statusCode = 413;
      message = 'Request body too large';
    } else {
      statusCode = bpErr.status || 400;
      message = bpErr.message || 'Bad request';
    }
  }
  // 3. AppError -> custom operational status
  else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  }
  // 4. Mongoose CastError -> 400
  else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid ${err.path}: '${err.value}' is not a valid format`;
  }
  // 5. Mongoose ValidationError -> 422
  else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 422;
    message = 'Validation error';
    errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }
  // 6. MongoDB Duplicate Key error (E11000) -> 409
  else if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  ) {
    statusCode = 409;
    const mongoErr = err as { keyValue?: Record<string, unknown> };
    const fieldNames = mongoErr.keyValue ? Object.keys(mongoErr.keyValue).join(', ') : 'field';
    message = `Duplicate key error: A record with that ${fieldNames} already exists`;
    errors = mongoErr.keyValue;
  }
  // 7. JWT Errors -> 401
  else if (
    err instanceof Error &&
    (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
  ) {
    statusCode = 401;
    message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
  }
  // 8. Generic / Unexpected errors -> 500
  else {
    statusCode = 500;
    message = 'Internal server error';
    logger.error(
      {
        err,
        method: req.method,
        url: req.originalUrl,
      },
      'Unhandled internal error'
    );
  }

  const rawId =
    req.id || (typeof res.getHeader === 'function' ? res.getHeader('X-Request-Id') : undefined);
  const requestId = rawId ? String(rawId) : undefined;

  const responsePayload: ErrorEnvelope = {
    success: false,
    message,
    ...(requestId ? { requestId } : {}),
    ...(errors !== undefined ? { errors } : {}),
  };

  if (env.NODE_ENV === 'development' && err instanceof Error && statusCode === 500) {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
};
