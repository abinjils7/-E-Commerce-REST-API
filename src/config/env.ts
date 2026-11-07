import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim() : val),
      z.enum(['development', 'production', 'test'])
    )
    .default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  USE_TRANSACTIONS: z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true' || val === '1';
    })
    .default(false),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(16).default(12),
  CORS_ORIGIN: z.string().default('*'),
  ADMIN_EMAIL: z.string().email('Invalid ADMIN_EMAIL').default('admin@example.com'),
  ADMIN_PASSWORD: z
    .string()
    .min(8, 'ADMIN_PASSWORD must be at least 8 characters')
    .default('AdminPassword123!'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

const parseEnv = (): Env => {
  const isProduction = (process.env.NODE_ENV || '').trim() === 'production';

  const rawMongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    (isProduction
      ? undefined
      : process.env.NODE_ENV === 'test'
        ? 'mongodb://localhost:27017/ecom_test'
        : 'mongodb://127.0.0.1:27017/ecom');

  if (isProduction && !rawMongoUri) {
    console.error('❌ MONGODB_URI is required in production');
    process.exit(1);
  }

  const rawJwtSecret = process.env.JWT_SECRET;

  if (isProduction && (!rawJwtSecret || rawJwtSecret.length < 32)) {
    console.error('❌ JWT_SECRET is required in production and must be at least 32 characters');
    process.exit(1);
  }

  const resolvedJwtSecret =
    rawJwtSecret ||
    (process.env.NODE_ENV === 'test'
      ? 'test_jwt_secret_key_at_least_32_characters_long_for_security'
      : 'super_secret_jwt_key_at_least_32_characters_long');

  const rawAdminEmail = process.env.ADMIN_EMAIL;
  const rawAdminPassword = process.env.ADMIN_PASSWORD;
  if (isProduction && !rawAdminEmail) {
    console.error('❌ ADMIN_EMAIL is required in production');
    process.exit(1);
  }
  if (isProduction && !rawAdminPassword) {
    console.error('❌ ADMIN_PASSWORD is required in production');
    process.exit(1);
  }

  const rawCorsOrigin = process.env.CORS_ORIGIN;
  if (isProduction && (!rawCorsOrigin || rawCorsOrigin === '*')) {
    console.error(
      '❌ CORS_ORIGIN must be explicitly set to a specific origin or comma-separated list of origins in production'
    );
    process.exit(1);
  }

  const rawEnv = {
    ...process.env,
    MONGODB_URI: rawMongoUri || 'mongodb://127.0.0.1:27017/ecom',
    MONGO_URI: rawMongoUri || 'mongodb://127.0.0.1:27017/ecom',
    JWT_SECRET: resolvedJwtSecret,
    ADMIN_EMAIL: rawAdminEmail || 'admin@example.com',
    ADMIN_PASSWORD: rawAdminPassword || 'AdminPassword123!',
  };

  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    console.error('❌ Environment configuration validation error:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();

export const getUseTransactions = (): boolean => {
  if (process.env.USE_TRANSACTIONS !== undefined) {
    const val = process.env.USE_TRANSACTIONS;
    return val === 'true' || val === '1';
  }
  return env.USE_TRANSACTIONS;
};

export const getCorsOrigins = (): string[] | string => {
  const originStr = process.env.CORS_ORIGIN || env.CORS_ORIGIN;
  if (originStr === '*') return '*';
  return originStr
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
};

export const getRateLimitMax = (): number => {
  if (process.env.RATE_LIMIT_MAX !== undefined) {
    const parsed = parseInt(process.env.RATE_LIMIT_MAX, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test' ? 10000 : env.RATE_LIMIT_MAX;
};

export const getAuthRateLimitMax = (): number => {
  if (process.env.AUTH_RATE_LIMIT_MAX !== undefined) {
    const parsed = parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test'
    ? 10000
    : env.AUTH_RATE_LIMIT_MAX;
};

export const getRateLimitWindowMs = (): number => {
  if (process.env.RATE_LIMIT_WINDOW_MS !== undefined) {
    const parsed = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return env.RATE_LIMIT_WINDOW_MS;
};

export const getAuthRateLimitWindowMs = (): number => {
  if (process.env.AUTH_RATE_LIMIT_WINDOW_MS !== undefined) {
    const parsed = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return env.AUTH_RATE_LIMIT_WINDOW_MS;
};
