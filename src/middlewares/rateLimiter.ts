import rateLimit from 'express-rate-limit';
import {
  env,
  getRateLimitMax,
  getAuthRateLimitMax,
  getRateLimitWindowMs,
  getAuthRateLimitWindowMs,
} from '../config/env';
import { Request, Response } from 'express';
import { RequestWithId } from './requestId';

export const generalRateLimiter = rateLimit({
  windowMs: getRateLimitWindowMs(),
  limit: () => getRateLimitMax(),
  skip: () => env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const requestId =
      (req as RequestWithId).id || (res.getHeader('X-Request-Id') as string) || undefined;
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later',
      ...(requestId ? { requestId } : {}),
    });
  },
});

export const authRateLimiter = rateLimit({
  windowMs: getAuthRateLimitWindowMs(),
  limit: () => getAuthRateLimitMax(),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const requestId =
      (req as RequestWithId).id || (res.getHeader('X-Request-Id') as string) || undefined;
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts, please try again later',
      ...(requestId ? { requestId } : {}),
    });
  },
});

export const generalLimiter = generalRateLimiter;
export const authLimiter = authRateLimiter;
