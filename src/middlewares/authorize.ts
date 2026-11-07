import { Request, Response, NextFunction, RequestHandler } from 'express';
import { UserRole } from '../models/user.model';
import { AppError } from '../utils/AppError';

export const authorize = (...allowedRoles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(AppError.forbidden('Forbidden: Insufficient permissions for this resource'));
    }

    next();
  };
};
