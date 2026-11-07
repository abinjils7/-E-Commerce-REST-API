import pino from 'pino';
import { env } from './env';
import { requestContext } from '../middlewares/requestId';

export const logger = pino({
  level: env.LOG_LEVEL,
  mixin() {
    const store = requestContext.getStore();
    return store?.requestId ? { requestId: store.requestId } : {};
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'req.headers.cookie',
      'headers.cookie',
      'cookie',
      'res.headers["set-cookie"]',
      'headers["set-cookie"]',
      'set-cookie',
      'password',
      'passwordHash',
      'currentPassword',
      'newPassword',
      'token',
      'body.password',
      'body.currentPassword',
      'body.newPassword',
      'body.token',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.cookie',
      '*.set-cookie',
    ],
    remove: true,
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});
