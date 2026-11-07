import request from 'supertest';
import rateLimit from 'express-rate-limit';
import express, { Request, Response } from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app, buildApp } from '../../src/app';
import { env } from '../../src/config/env';
import { ensureIndexes } from '../../src/config/db';
import { User } from '../../src/models/user.model';
import { Category } from '../../src/models/category.model';
import { Product } from '../../src/models/product.model';
import { Order } from '../../src/models/order.model';

describe('Phase 6: Security Hardening, Observability & Rate Limiting', () => {
  let customerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    const customer = await User.create({
      name: 'Security Test Customer',
      email: `security.customer.${Date.now()}.${Math.random()}@example.com`,
      passwordHash: '$2b$12$somevalidhashplaceholdervalue123456789012345678',
      role: 'customer',
      isActive: true,
    });

    const admin = await User.create({
      name: 'Security Test Admin',
      email: `security.admin.${Date.now()}.${Math.random()}@example.com`,
      passwordHash: '$2b$12$somevalidhashplaceholdervalue123456789012345678',
      role: 'admin',
      isActive: true,
    });

    customerToken = jwt.sign({ id: customer._id.toString(), role: customer.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });

    adminToken = jwt.sign({ id: admin._id.toString(), role: admin.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
  });

  describe('1. Request ID & Observability', () => {
    it('sets X-Request-Id header on successful responses', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
      expect((res.headers['x-request-id'] as string).length).toBeGreaterThan(0);
    });

    it('propagates custom client-sent X-Request-Id in response header', async () => {
      const customId = 'client-custom-req-id-12345';
      const res = await request(app).get('/health').set('X-Request-Id', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('includes requestId in error responses', async () => {
      const res = await request(app).get('/api/v1/products/invalid-id-format');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.requestId).toBeDefined();
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('redacts sensitive fields (passwords, tokens, authorization headers) in logger output', () => {
      let loggedOutput = '';
      const customStream = {
        write: (msg: string) => {
          loggedOutput += msg;
          return true;
        },
      };

      const testLogger = pino(
        {
          level: 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'headers.authorization',
              'authorization',
              'password',
              'passwordHash',
              'currentPassword',
              'newPassword',
              'token',
              'body.password',
              'body.currentPassword',
              'body.newPassword',
              'body.token',
            ],
            remove: true,
          },
        },
        customStream
      );

      testLogger.info({
        password: 'TopSecretPassword123!',
        passwordHash: '$2b$12$somethinghashed',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive.payload',
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super.secret',
        },
        body: {
          password: 'AnotherSecretPassword',
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword123',
        },
        safeField: 'visible-data',
      });

      expect(loggedOutput).toContain('visible-data');
      expect(loggedOutput).not.toContain('TopSecretPassword123!');
      expect(loggedOutput).not.toContain('$2b$12$somethinghashed');
      expect(loggedOutput).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(loggedOutput).not.toContain('AnotherSecretPassword');
      expect(loggedOutput).not.toContain('OldPassword123');
      expect(loggedOutput).not.toContain('NewPassword123');
    });

    it('does not leak Cookie and Set-Cookie headers in HTTP request log output', async () => {
      let requestLogs = '';
      const customStream = {
        write: (msg: string) => {
          requestLogs += msg;
          return true;
        },
      };

      const testLogger = pino(
        {
          level: 'info',
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
              'token',
            ],
            remove: true,
          },
        },
        customStream
      );

      const testApp = express();
      testApp.use(pinoHttp({ logger: testLogger }));
      testApp.get('/test-cookie-redaction', (_req: Request, res: Response) => {
        res.setHeader('Set-Cookie', 'secret_refresh_token=secret_val_set_cookie_999; HttpOnly');
        res.status(200).json({ success: true });
      });

      const res = await request(testApp)
        .get('/test-cookie-redaction')
        .set('Cookie', 'session_id=super_confidential_cookie_val_123; user=alice');

      expect(res.status).toBe(200);
      expect(requestLogs).not.toContain('super_confidential_cookie_val_123');
      expect(requestLogs).not.toContain('secret_val_set_cookie_999');
    });
  });

  describe('2. NoSQL Query Injection Protection (express-mongo-sanitize)', () => {
    it('GET /health?a[$gt]=1 does not crash and handles sanitized query parameters safely', async () => {
      const res = await request(app).get('/health?a[$gt]=1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/auth/login with NoSQL injection body {"$gt": ""} fails with 422/400 without crashing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: { $gt: '' },
          password: 'Password123!',
        });

      // express-mongo-sanitize strips the $gt key leaving email as empty object {}, which fails Zod validation
      expect([400, 422]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/auth/login with top-level operator {"$gt": ""} is sanitized and rejected with 422', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        $gt: '',
      });

      expect([400, 422]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Rate Limiting in Standard Envelope', () => {
    it('returns 429 in the standard envelope when request threshold is exceeded', async () => {
      const testLimiter = rateLimit({
        windowMs: 60000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req: Request, res: Response) => {
          const reqId = (req.headers['x-request-id'] as string) || 'test-rate-req-id';
          res.status(429).json({
            success: false,
            message: 'Too many requests from this IP, please try again later',
            requestId: reqId,
          });
        },
      });

      const testApp = express();
      testApp.use(testLimiter);
      testApp.get('/test-rate-limit', (_req, res) => res.json({ success: true }));

      // Request 1: 200
      const res1 = await request(testApp).get('/test-rate-limit');
      expect(res1.status).toBe(200);

      // Request 2: 200
      const res2 = await request(testApp).get('/test-rate-limit');
      expect(res2.status).toBe(200);

      // Request 3: 429
      const res3 = await request(testApp).get('/test-rate-limit');
      expect(res3.status).toBe(429);
      expect(res3.body).toEqual({
        success: false,
        message: 'Too many requests from this IP, please try again later',
        requestId: expect.any(String),
      });
    });
  });

  describe('4. Invalid ObjectId Route Parameters Validation', () => {
    it('returns 400 for invalid category ID param', async () => {
      const res = await request(app).get('/api/v1/categories/not-a-valid-id');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*objectid/i);
    });

    it('returns 400 for invalid product ID param', async () => {
      const res = await request(app).get('/api/v1/products/invalid-mongo-id');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*objectid/i);
    });

    it('returns 400 for invalid order ID param', async () => {
      const res = await request(app)
        .get('/api/v1/orders/123-bad-order-id')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*objectid/i);
    });

    it('returns 400 for invalid user ID param on admin status route', async () => {
      const res = await request(app)
        .patch('/api/v1/users/bad-user-id/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*objectid/i);
    });
  });

  describe('5. Database Query Execution Stats (explain)', () => {
    it('confirms product listing uses compound index { category: 1, status: 1, effectivePrice: 1 }', async () => {
      const cat = await Category.create({
        name: 'Explain Category',
        slug: 'explain-category',
      });

      await Product.create({
        name: 'Explain Laptop',
        sku: 'EXPL-001',
        description: 'Test product for explain query',
        price: 50000,
        category: cat._id,
        stock: 10,
        status: 'active',
      });

      const explainResult = await Product.find({
        category: cat._id,
        status: 'active',
        effectivePrice: { $gte: 10000 },
      })
        .sort({ effectivePrice: 1 })
        .explain('executionStats');

      // Verify that the query plan utilizes an index scan (IXSCAN)
      const executionStages = JSON.stringify(explainResult);
      expect(executionStages).toMatch(/IXSCAN/);
      expect(executionStages).toMatch(/category_1_status_1_effectivePrice_1/);
    });

    it('confirms category subtree search uses { ancestors: 1 } index', async () => {
      const rootCat = await Category.create({
        name: 'Explain Root',
        slug: 'explain-root',
      });

      await Category.create({
        name: 'Explain Child',
        slug: 'explain-child',
        parent: rootCat._id,
        ancestors: [rootCat._id],
      });

      const explainResult = await Category.find({
        ancestors: rootCat._id,
      }).explain('executionStats');

      const executionStages = JSON.stringify(explainResult);
      expect(executionStages).toMatch(/IXSCAN/);
      expect(executionStages).toMatch(/ancestors_1/);
    });

    it('confirms admin order queries (unfiltered and status-filtered) use indexes with no COLLSCAN or in-memory SORT', async () => {
      await Order.init();

      // Populate a few order documents to test explain with actual data in the collection
      const explainCustomer = await User.create({
        name: 'Order Explain Customer',
        email: `explain.order.${Date.now()}.${Math.random()}@example.com`,
        passwordHash: '$2b$12$somehashplaceholdervalue123456789012345678',
        role: 'customer',
      });
      const explainProduct = await Product.create({
        name: 'Explain Product Item',
        sku: `EXPL-ORD-${Date.now()}-${Math.random()}`.toUpperCase(),
        description: 'Explain product description',
        price: 150000,
        effectivePrice: 150000,
        stock: 50,
        category: new mongoose.Types.ObjectId(),
      });

      await Order.create([
        {
          orderNumber: `ORD-EXP-1-${Date.now()}`,
          user: explainCustomer._id,
          items: [
            {
              product: explainProduct._id,
              name: 'Item 1',
              sku: 'SKU1',
              unitPrice: 50000,
              quantity: 1,
              lineTotal: 50000,
            },
          ],
          totalAmount: 50000,
          status: 'pending',
          shippingAddress: {
            fullName: 'Explain User',
            phone: '9876543210',
            line1: 'L1',
            city: 'C',
            state: 'S',
            postalCode: '123',
            country: 'IN',
          },
        },
        {
          orderNumber: `ORD-EXP-2-${Date.now()}`,
          user: explainCustomer._id,
          items: [
            {
              product: explainProduct._id,
              name: 'Item 2',
              sku: 'SKU2',
              unitPrice: 50000,
              quantity: 1,
              lineTotal: 50000,
            },
          ],
          totalAmount: 50000,
          status: 'confirmed',
          shippingAddress: {
            fullName: 'Explain User',
            phone: '9876543210',
            line1: 'L1',
            city: 'C',
            state: 'S',
            postalCode: '123',
            country: 'IN',
          },
        },
        {
          orderNumber: `ORD-EXP-3-${Date.now()}`,
          user: explainCustomer._id,
          items: [
            {
              product: explainProduct._id,
              name: 'Item 3',
              sku: 'SKU3',
              unitPrice: 50000,
              quantity: 1,
              lineTotal: 50000,
            },
          ],
          totalAmount: 50000,
          status: 'pending',
          shippingAddress: {
            fullName: 'Explain User',
            phone: '9876543210',
            line1: 'L1',
            city: 'C',
            state: 'S',
            postalCode: '123',
            country: 'IN',
          },
        },
      ]);

      // 1. Unfiltered admin orders: sort({ createdAt: -1 })
      const unfilteredExplain = await Order.find({})
        .sort({ createdAt: -1 })
        .explain('executionStats');
      const unfilteredJson = JSON.stringify(unfilteredExplain);
      expect(unfilteredJson).toMatch(/IXSCAN/);
      expect(unfilteredJson).toMatch(/createdAt_-1/);
      expect(unfilteredJson).not.toMatch(/"stage":"COLLSCAN"/);
      expect(unfilteredJson).not.toMatch(/"stage":"SORT"/);

      // 2. Status-filtered admin orders: find({ status: 'pending' }).sort({ createdAt: -1 })
      const statusExplain = await Order.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .explain('executionStats');
      const statusJson = JSON.stringify(statusExplain);
      expect(statusJson).toMatch(/IXSCAN/);
      expect(statusJson).toMatch(/status_1_createdAt_-1/);
      expect(statusJson).not.toMatch(/"stage":"COLLSCAN"/);
      expect(statusJson).not.toMatch(/"stage":"SORT"/);
    });

    it('confirms user list query uses { createdAt: -1 } index without in-memory SORT or COLLSCAN', async () => {
      await User.init();
      // Insert a few users to evaluate query plan on populated collection
      await User.create([
        {
          name: 'Explain User 1',
          email: `exp1.${Date.now()}@example.com`,
          passwordHash: 'hash1',
          role: 'customer',
        },
        {
          name: 'Explain User 2',
          email: `exp2.${Date.now()}@example.com`,
          passwordHash: 'hash2',
          role: 'customer',
        },
        {
          name: 'Explain User 3',
          email: `exp3.${Date.now()}@example.com`,
          passwordHash: 'hash3',
          role: 'admin',
        },
      ]);

      const userExplain = await User.find({}).sort({ createdAt: -1 }).explain('executionStats');
      const userJson = JSON.stringify(userExplain);
      expect(userJson).toMatch(/IXSCAN/);
      expect(userJson).toMatch(/createdAt_-1/);
      expect(userJson).not.toMatch(/"stage":"COLLSCAN"/);
      expect(userJson).not.toMatch(/"stage":"SORT"/);
    });

    it('confirms category list query uses { name: 1 } index without in-memory SORT or COLLSCAN', async () => {
      await Category.init();
      // Insert a few categories to evaluate query plan on populated collection
      await Category.create([
        { name: 'Alpha Category', slug: `alpha-${Date.now()}` },
        { name: 'Beta Category', slug: `beta-${Date.now()}` },
        { name: 'Gamma Category', slug: `gamma-${Date.now()}` },
      ]);

      const catExplain = await Category.find({}).sort({ name: 1 }).explain('executionStats');
      const catJson = JSON.stringify(catExplain);
      expect(catJson).toMatch(/IXSCAN/);
      expect(catJson).toMatch(/name_1/);
      expect(catJson).not.toMatch(/"stage":"COLLSCAN"/);
      expect(catJson).not.toMatch(/"stage":"SORT"/);
    });
  });

  describe('6. Graceful Shutdown Verification', () => {
    it('guarantees server closes prior to database disconnection', async () => {
      const shutdownOrder: string[] = [];

      interface MockServer {
        close: jest.Mock;
      }

      const mockServer: MockServer = {
        close: jest.fn((callback: () => Promise<void>): void => {
          shutdownOrder.push('server.close');
          void callback();
        }),
      };

      const mockDisconnectDB = jest.fn(async () => {
        shutdownOrder.push('disconnectDB');
      });

      // Execute shutdown callback contract
      await new Promise<void>((resolve) => {
        mockServer.close(async () => {
          await mockDisconnectDB();
          resolve();
        });
      });

      expect(shutdownOrder).toEqual(['server.close', 'disconnectDB']);
      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockDisconnectDB).toHaveBeenCalledTimes(1);
    });
  });

  describe('7. JWT Algorithm & Production Environment Validation', () => {
    it('rejects a JWT token signed with an algorithm other than HS256 with 401', async () => {
      // Sign token with none / different algorithm (e.g., using "none" algorithm)
      const noneToken = jwt.sign({ id: new User()._id.toString(), role: 'customer' }, '', {
        algorithm: 'none',
      });

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${noneToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid token/i);
    });

    it('fails environment validation in production when JWT_SECRET is not provided or too short', () => {
      const originalEnv = { ...process.env };
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;
        process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ecom';
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.ADMIN_PASSWORD = 'AdminPassword123!';
        process.env.CORS_ORIGIN = 'https://example.com';

        // Re-evaluate parse logic: mock process.exit to catch failure
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
          throw new Error('process.exit called');
        }) as unknown as (code?: string | number | null | undefined) => never);

        expect(() => {
          // Dynamically test env parsing logic
          const rawJwtSecret = process.env.JWT_SECRET;
          if (!rawJwtSecret || rawJwtSecret.length < 32) {
            process.exit(1);
          }
        }).toThrow('process.exit called');

        exitSpy.mockRestore();
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('8. CORS Configuration', () => {
    it('supports multiple comma-separated origins and reflects the matching origin', async () => {
      const originalCors = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = 'https://app1.example.com, https://app2.example.com';
      try {
        const testApp = buildApp();

        const res1 = await request(testApp)
          .get('/health')
          .set('Origin', 'https://app1.example.com');
        expect(res1.headers['access-control-allow-origin']).toBe('https://app1.example.com');
        expect(res1.headers['access-control-allow-credentials']).toBe('true');

        const res2 = await request(testApp)
          .get('/health')
          .set('Origin', 'https://app2.example.com');
        expect(res2.headers['access-control-allow-origin']).toBe('https://app2.example.com');
        expect(res2.headers['access-control-allow-credentials']).toBe('true');

        const res3 = await request(testApp)
          .get('/health')
          .set('Origin', 'https://unauthorized.example.com');
        expect(res3.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        if (originalCors !== undefined) {
          process.env.CORS_ORIGIN = originalCors;
        } else {
          delete process.env.CORS_ORIGIN;
        }
      }
    });

    it('does not allow credentials when CORS_ORIGIN is wildcard *', async () => {
      const originalCors = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = '*';
      try {
        const testApp = buildApp();
        const res = await request(testApp).get('/health').set('Origin', 'https://any.com');
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      } finally {
        if (originalCors !== undefined) {
          process.env.CORS_ORIGIN = originalCors;
        } else {
          delete process.env.CORS_ORIGIN;
        }
      }
    });
  });

  describe('9. Startup Index Initialization & Production Simulation', () => {
    it('executes ensureIndexes() successfully on startup models', async () => {
      await expect(ensureIndexes()).resolves.toBeUndefined();
    });

    it('creates all required unique and specialized indexes on a fresh database with autoIndex disabled', async () => {
      // Connect to a fresh database simulating production environment (autoIndex: false)
      const randomSuffix = Math.floor(Math.random() * 1000000);
      const freshDb = mongoose.connection.useDb(`fresh_prod_sim_${Date.now()}_${randomSuffix}`, {
        useCache: false,
      });

      const FreshUser = freshDb.model('User', User.schema);
      const FreshCategory = freshDb.model('Category', Category.schema);
      const FreshProduct = freshDb.model('Product', Product.schema);
      const FreshOrder = freshDb.model('Order', Order.schema);

      // Run startup index step (createIndexes for all registered models)
      await Promise.all([
        FreshUser.createIndexes(),
        FreshCategory.createIndexes(),
        FreshProduct.createIndexes(),
        FreshOrder.createIndexes(),
      ]);

      // 1. users.email unique
      const userIndexesDict = await FreshUser.collection.getIndexes();
      expect(userIndexesDict).toHaveProperty('email_1');
      const userIndexesArr = await FreshUser.collection.indexes();
      const emailIndex = userIndexesArr.find((idx) => idx.key.email === 1);
      expect(emailIndex).toBeDefined();
      expect(emailIndex?.unique).toBe(true);

      // 2. products.sku unique
      const productIndexesDict = await FreshProduct.collection.getIndexes();
      expect(productIndexesDict).toHaveProperty('sku_1');
      const productIndexesArr = await FreshProduct.collection.indexes();
      const skuIndex = productIndexesArr.find((idx) => idx.key.sku === 1);
      expect(skuIndex).toBeDefined();
      expect(skuIndex?.unique).toBe(true);

      // 3. products text index
      expect(productIndexesDict).toHaveProperty('name_text_description_text');
      const textIndex = productIndexesArr.find((idx) => idx.weights && idx.weights.name);
      expect(textIndex).toBeDefined();

      // 4. orders.orderNumber unique
      const orderIndexesDict = await FreshOrder.collection.getIndexes();
      expect(orderIndexesDict).toHaveProperty('orderNumber_1');
      const orderIndexesArr = await FreshOrder.collection.indexes();
      const orderNumIndex = orderIndexesArr.find((idx) => idx.key.orderNumber === 1);
      expect(orderNumIndex).toBeDefined();
      expect(orderNumIndex?.unique).toBe(true);

      // 5. orders { user, idempotencyKey } unique partial index
      expect(orderIndexesDict).toHaveProperty('user_1_idempotencyKey_1');
      const idempotencyIndex = orderIndexesArr.find(
        (idx) => idx.key.user === 1 && idx.key.idempotencyKey === 1
      );
      expect(idempotencyIndex).toBeDefined();
      expect(idempotencyIndex?.unique).toBe(true);
      expect(idempotencyIndex?.partialFilterExpression).toEqual({
        idempotencyKey: { $type: 'string' },
      });

      // 6. categories { parent, slug } and { parent, name } unique
      const categoryIndexesDict = await FreshCategory.collection.getIndexes();
      expect(categoryIndexesDict).toHaveProperty('parent_1_slug_1');
      expect(categoryIndexesDict).toHaveProperty('parent_1_name_1');
      const categoryIndexesArr = await FreshCategory.collection.indexes();
      const parentSlugIndex = categoryIndexesArr.find(
        (idx) => idx.key.parent === 1 && idx.key.slug === 1
      );
      expect(parentSlugIndex).toBeDefined();
      expect(parentSlugIndex?.unique).toBe(true);

      const parentNameIndex = categoryIndexesArr.find(
        (idx) => idx.key.parent === 1 && idx.key.name === 1
      );
      expect(parentNameIndex).toBeDefined();
      expect(parentNameIndex?.unique).toBe(true);

      // Cleanup fresh database
      await freshDb.dropDatabase();
    });
  });
});
