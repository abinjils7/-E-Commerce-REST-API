import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { connectDB, disconnectDB, ensureIndexes } from './config/db';
import { logger } from './config/logger';

const startServer = async (): Promise<http.Server> => {
  await connectDB(env.MONGODB_URI);

  try {
    await ensureIndexes();
  } catch (error) {
    logger.fatal({ error }, 'Failed to build database indexes at startup, exiting process');
    await disconnectDB();
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(
      ` Server running in [${env.NODE_ENV}] mode on port ${env.PORT} (Transactions: ${env.USE_TRANSACTIONS})`
    );
  });

  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectDB();
      logger.info('Process termination complete');
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ err: reason }, 'Unhandled Promise Rejection detected');
  });

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught Exception detected, shutting down');
    process.exit(1);
  });

  return server;
};

if (env.NODE_ENV !== 'test') {
  void startServer();
}

export { startServer };
