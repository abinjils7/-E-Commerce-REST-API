import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';
import { User } from '../models/user.model';
import { Category } from '../models/category.model';
import { Product } from '../models/product.model';
import { Order } from '../models/order.model';

export const connectDB = async (uri?: string): Promise<typeof mongoose> => {
  const connectionUri = uri || env.MONGODB_URI;

  try {
    const conn = await mongoose.connect(connectionUri, {
      autoIndex: env.NODE_ENV !== 'production',
    });
    logger.info({ host: conn.connection.host, name: conn.connection.name }, 'Connected to MongoDB');
    return conn;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB');
    throw error;
  }
};

export const ensureIndexes = async (): Promise<void> => {
  try {
    logger.info('Building database indexes for registered models...');
    const models = [User, Category, Product, Order];
    await Promise.all(models.map((model) => model.createIndexes()));
    logger.info('Database indexes created/verified successfully');
  } catch (error) {
    logger.fatal({ error }, 'Failed to build database indexes');
    throw error;
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from MongoDB');
    throw error;
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection lost');
});

mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'MongoDB connection error');
});
