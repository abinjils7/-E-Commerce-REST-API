import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { AppError } from '../utils/AppError';

export interface JwtPayload {
  id: string;
  role: 'admin' | 'customer';
  iat?: number;
  exp?: number;
}

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Authentication token missing or invalid format');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw AppError.unauthorized('Authentication token missing');
    }

    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    if (!decoded || !decoded.id) {
      throw AppError.unauthorized('Invalid authentication token payload');
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      throw AppError.unauthorized('User associated with this token no longer exists');
    }

    if (!user.isActive) {
      throw AppError.forbidden('User account is deactivated');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
