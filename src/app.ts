import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { env, getCorsOrigins } from './config/env';
import { logger } from './config/logger';
import { requestIdMiddleware } from './middlewares/requestId';
import { generalLimiter, authLimiter } from './middlewares/rateLimiter';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';
import { authRoutes } from './modules/auth/auth.routes';
import { userRoutes } from './modules/users/user.routes';
import { categoryRoutes } from './modules/categories/category.routes';
import { productRoutes } from './modules/products/product.routes';
import { orderRoutes } from './modules/orders/order.routes';
import { productController } from './modules/products/product.controller';
import { authenticate } from './middlewares/authenticate';
import { authorize } from './middlewares/authorize';
import { validate } from './middlewares/validate';
import { adminProductQuerySchema } from './modules/products/product.schema';
import { asyncHandler } from './utils/asyncHandler';

export const buildApp = (): Application => {
  const app = express();

  // Request ID context & response header
  app.use(requestIdMiddleware);

  // HTTP Request Logging with request ID and redaction
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) =>
        (typeof req.id === 'string' && req.id) ||
        (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
        'unknown',
      autoLogging: {
        ignore: (req) => env.NODE_ENV === 'test' && req.url === '/health',
      },
    })
  );

  // Security headers & CORS
  app.use(helmet());
  const corsOrigins = getCorsOrigins();
  app.use(
    cors({
      origin: corsOrigins,
      credentials: corsOrigins !== '*',
    })
  );

  // Body parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // MongoDB query injection sanitizer
  app.use(mongoSanitize());

  // General rate limiter
  app.use(generalLimiter);

  // GET /health - checks database connectivity
  app.get('/health', (_req: Request, res: Response) => {
    const isDbConnected = mongoose.connection.readyState === 1;
    const statusCode = isDbConnected ? 200 : 503;

    res.status(statusCode).json({
      success: isDbConnected,
      message: isDbConnected ? 'Service healthy' : 'Database connection unavailable',
      data: {
        status: isDbConnected ? 'healthy' : 'unhealthy',
        database: isDbConnected ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // REST API v1 Routing
  const apiV1 = express.Router();

  apiV1.use('/auth', authLimiter, authRoutes);
  apiV1.use('/users', userRoutes);
  apiV1.use('/categories', categoryRoutes);
  apiV1.use('/products', productRoutes);
  apiV1.use('/orders', orderRoutes);

  // Additional route alias for GET /admin/products
  apiV1.get(
    '/admin/products',
    authenticate,
    authorize('admin'),
    validate({ query: adminProductQuerySchema }),
    asyncHandler((req, res) => productController.getAdminProducts(req, res))
  );

  app.use('/api/v1', apiV1);

  // 404 Handler for undefined routes
  app.use(notFound);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
};

export const createApp = buildApp;
export const app = buildApp();
export default app;
