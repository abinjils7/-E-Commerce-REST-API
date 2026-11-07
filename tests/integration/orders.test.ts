import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { Product } from '../../src/models/product.model';
import { Category } from '../../src/models/category.model';
import { Order } from '../../src/models/order.model';
import { User } from '../../src/models/user.model';
import { orderService } from '../../src/modules/orders/order.service';
import { env } from '../../src/config/env';

describe.each([
  { useTransactions: true, modeLabel: 'MongoDB Transactions (USE_TRANSACTIONS=true)' },
  { useTransactions: false, modeLabel: 'Manual Compensation (USE_TRANSACTIONS=false)' },
])('Orders Module Integration Tests - $modeLabel', ({ useTransactions }) => {
  const app = createApp();
  let adminToken: string;
  let customerToken1: string;
  let customerToken2: string;
  let customerUser1Id: string;
  let testCategory: Types.ObjectId;

  const validAddress = {
    fullName: 'Jane Doe',
    phone: '+1-555-0199',
    line1: '123 Market Street',
    line2: 'Suite 400',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'USA',
  };

  beforeAll(async () => {
    process.env.USE_TRANSACTIONS = useTransactions ? 'true' : 'false';
    await Order.syncIndexes();
    await Product.syncIndexes();
    await Category.syncIndexes();
    await User.syncIndexes();
  });

  beforeEach(async () => {
    process.env.USE_TRANSACTIONS = useTransactions ? 'true' : 'false';
    await Order.deleteMany({});
    await Product.deleteMany({});
    await Category.deleteMany({});
    await User.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    const admin = await User.create({
      name: 'System Admin',
      email: 'admin@orders.com',
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    const cust1 = await User.create({
      name: 'Customer One',
      email: 'cust1@orders.com',
      passwordHash,
      role: 'customer',
      isActive: true,
    });
    customerUser1Id = cust1._id.toString();

    const cust2 = await User.create({
      name: 'Customer Two',
      email: 'cust2@orders.com',
      passwordHash,
      role: 'customer',
      isActive: true,
    });

    adminToken = jwt.sign({ id: admin._id.toString(), role: admin.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
    customerToken1 = jwt.sign({ id: cust1._id.toString(), role: cust1.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
    customerToken2 = jwt.sign({ id: cust2._id.toString(), role: cust2.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });

    const cat = await Category.create({ name: 'Gadgets', slug: 'gadgets' });
    testCategory = cat._id as Types.ObjectId;
  });

  describe('POST /api/v1/orders - Concurrency & Atomic Stock Reservation', () => {
    it('concurrency: stock 5, 10 parallel orders of qty 1 -> exactly 5 succeed, 5 get 409, final stock 0', async () => {
      const product = await Product.create({
        name: 'Flash Sale Wireless Mouse',
        sku: 'MOUSE-001',
        description: 'High speed gaming mouse',
        price: 3000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const promises = Array.from({ length: 10 }).map(() =>
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken1}`)
          .send({
            items: [{ productId: product._id.toString(), quantity: 1 }],
            shippingAddress: validAddress,
          })
      );

      const responses = await Promise.all(promises);

      const successResponses = responses.filter((r) => r.status === 201);
      const conflictResponses = responses.filter((r) => r.status === 409);

      expect(successResponses).toHaveLength(5);
      expect(conflictResponses).toHaveLength(5);

      for (const res of conflictResponses) {
        expect(res.body.message).toMatch(/insufficient stock/i);
      }

      // Check final stock in DB
      const refreshedProduct = await Product.findById(product._id);
      expect(refreshedProduct?.stock).toBe(0);

      // Verify exactly 5 orders exist
      const ordersCount = await Order.countDocuments({});
      expect(ordersCount).toBe(5);
    });

    it('two customers each ordering 3 of stock 5 in parallel -> one succeeds, one 409, stock 2', async () => {
      const product = await Product.create({
        name: 'Mechanical Keyboard',
        sku: 'KB-001',
        description: 'RGB mechanical keyboard',
        price: 8000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken1}`)
          .send({
            items: [{ productId: product._id.toString(), quantity: 3 }],
            shippingAddress: validAddress,
          }),
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken2}`)
          .send({
            items: [{ productId: product._id.toString(), quantity: 3 }],
            shippingAddress: validAddress,
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.message).toMatch(/insufficient stock/i);

      // Verify stock in database is exactly 5 - 3 = 2
      const refreshed = await Product.findById(product._id);
      expect(refreshed?.stock).toBe(2);

      // Verify exactly 1 order exists
      const totalOrders = await Order.countDocuments({});
      expect(totalOrders).toBe(1);
    });

    it('multi-item order where the last item lacks stock -> all stock unchanged and no order created', async () => {
      const prodA = await Product.create({
        name: 'Product A',
        sku: 'PROD-A',
        description: 'Item with plenty of stock',
        price: 1500,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const prodB = await Product.create({
        name: 'Product B',
        sku: 'PROD-B',
        description: 'Item with low stock',
        price: 2500,
        stock: 1,
        category: testCategory,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [
            { productId: prodA._id.toString(), quantity: 2 },
            { productId: prodB._id.toString(), quantity: 5 }, // Fails: requires 5, only 1 available
          ],
          shippingAddress: validAddress,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/insufficient stock for item.*Product B/i);

      // Verify prodA was compensated back to 10 and prodB remained 1
      const refreshedA = await Product.findById(prodA._id);
      const refreshedB = await Product.findById(prodB._id);
      expect(refreshedA?.stock).toBe(10);
      expect(refreshedB?.stock).toBe(1);

      // Verify no order was created
      const count = await Order.countDocuments({});
      expect(count).toBe(0);
    });

    it('Order.create throws after reservation -> all stock restored and no order exists', async () => {
      const prod = await Product.create({
        name: 'Product For Error',
        sku: 'ERR-PROD',
        description: 'Testing rollback on creation failure',
        price: 4000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const createSpy = jest.spyOn(Order, 'create').mockImplementationOnce(() => {
        throw new Error('Simulated database write error during order creation');
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 4 }],
          shippingAddress: validAddress,
        });

      createSpy.mockRestore();

      expect(res.status).toBe(500);

      // Stock must be restored to 10
      const refreshed = await Product.findById(prod._id);
      expect(refreshed?.stock).toBe(10);

      const count = await Order.countDocuments({});
      expect(count).toBe(0);
    });

    it('withTransaction automatically retries and succeeds when encountering TransientTransactionError', async () => {
      if (!useTransactions) return; // Only applies to MongoDB transactions mode

      const product = await Product.create({
        name: 'Transient Retry Product',
        sku: 'TRETRY-001',
        description: 'Testing transient retry in withTransaction',
        price: 2500,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      let simulatedTransientFailure = false;
      const originalFindOneAndUpdate = Product.findOneAndUpdate.bind(Product);

      const findSpy = jest.spyOn(Product, 'findOneAndUpdate').mockImplementation(function (
        this: unknown,
        ...args: Parameters<typeof Product.findOneAndUpdate>
      ) {
        if (!simulatedTransientFailure) {
          simulatedTransientFailure = true;
          // Throw MongoServerError with TransientTransactionError label to trigger driver retry
          const transientErr = new mongoose.mongo.MongoServerError({
            message: 'WriteConflict error simulated',
            errorLabels: ['TransientTransactionError'],
          });
          throw transientErr;
        }
        return originalFindOneAndUpdate.apply(this, args);
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: product._id.toString(), quantity: 2 }],
          shippingAddress: validAddress,
        });

      findSpy.mockRestore();

      expect(simulatedTransientFailure).toBe(true);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify stock was deducted once (5 - 2 = 3), not twice despite the transaction retry
      const refreshed = await Product.findById(product._id);
      expect(refreshed?.stock).toBe(3);

      const totalOrders = await Order.countDocuments({ user: customerUser1Id });
      expect(totalOrders).toBe(1);
    });
  });

  describe('Validation, Pricing Snapshot & Backend Calculations', () => {
    it('rejects duplicate productIds with 422', async () => {
      const p1 = new Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [
            { productId: p1, quantity: 1 },
            { productId: p1, quantity: 2 },
          ],
          shippingAddress: validAddress,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('rejects order with inactive product with 422', async () => {
      const inactiveProd = await Product.create({
        name: 'Inactive Watch',
        sku: 'INACT-001',
        description: 'Old discontinued watch',
        price: 5000,
        stock: 20,
        category: testCategory,
        status: 'inactive',
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: inactiveProd._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/inactive and cannot be ordered/i);
    });

    it('rejects order with missing product with 422', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: nonExistentId, quantity: 1 }],
          shippingAddress: validAddress,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/does not exist/i);
    });

    it('ignores client-sent prices and correctly calculates totals using effectivePrice (sale price)', async () => {
      const regularProd = await Product.create({
        name: 'Regular Cable',
        sku: 'CBL-001',
        description: 'USB-C Cable',
        price: 1500, // 1500 paise
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const saleProd = await Product.create({
        name: 'On-Sale Earbuds',
        sku: 'EAR-001',
        description: 'True wireless earbuds',
        price: 10000,
        salePrice: 7500, // effectivePrice = 7500 paise
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [
            { productId: regularProd._id.toString(), quantity: 2, price: 1, unitPrice: 1 }, // Malicious client attempt: 1 paise
            { productId: saleProd._id.toString(), quantity: 1, price: 1, unitPrice: 1 },
          ],
          shippingAddress: validAddress,
        });

      expect(res.status).toBe(201);
      const order = res.body.data;

      // Regular line: 1500 * 2 = 3000
      // Sale line: 7500 * 1 = 7500
      // Expected total: 10500 paise
      expect(order.totalAmount).toBe(10500);

      const regularSnapshot = order.items.find((i: { sku: string }) => i.sku === 'CBL-001');
      expect(regularSnapshot.unitPrice).toBe(1500);
      expect(regularSnapshot.quantity).toBe(2);
      expect(regularSnapshot.lineTotal).toBe(3000);

      const saleSnapshot = order.items.find((i: { sku: string }) => i.sku === 'EAR-001');
      expect(saleSnapshot.unitPrice).toBe(7500);
      expect(saleSnapshot.quantity).toBe(1);
      expect(saleSnapshot.lineTotal).toBe(7500);

      // Verify human-readable orderNumber format
      expect(order.orderNumber).toMatch(/^ORD-\d+-[0-9A-F]{6}$/);
    });
  });

  describe('Idempotency Handling', () => {
    it('idempotency key returns original order on replay (200 status, no duplicate deduction)', async () => {
      const prod = await Product.create({
        name: 'Idempotency Test Item',
        sku: 'IDEM-001',
        description: 'Test idempotency replay',
        price: 2000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const payload = {
        items: [{ productId: prod._id.toString(), quantity: 2 }],
        shippingAddress: validAddress,
      };

      const idempotencyKey = 'key-test-123456';

      // First call -> 201 Created
      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const orderId1 = res1.body.data._id;

      // Second call (replay) -> 200 OK with same order
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.data._id).toBe(orderId1);
      expect(res2.body.message).toMatch(/replayed/i);

      // Verify stock deducted only once: 10 - 2 = 8
      const refreshed = await Product.findById(prod._id);
      expect(refreshed?.stock).toBe(8);

      // Verify only 1 order exists in database
      const count = await Order.countDocuments({ idempotencyKey });
      expect(count).toBe(1);
    });

    it('rejects same idempotency key with different payload with 409 Conflict', async () => {
      const p1 = await Product.create({
        name: 'Item One',
        sku: 'ITEM-1',
        description: 'Item 1',
        price: 1000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const p2 = await Product.create({
        name: 'Item Two',
        sku: 'ITEM-2',
        description: 'Item 2',
        price: 2000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const idempotencyKey = 'diff-payload-key-1';

      // First call
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          items: [{ productId: p1._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      // Second call with different items
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          items: [{ productId: p2._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toMatch(/different request payload/i);
    });

    it('two parallel identical idempotent requests -> one order, one stock deduction', async () => {
      const prod = await Product.create({
        name: 'Parallel Idempotent Item',
        sku: 'PARA-IDEM',
        description: 'Concurrent idempotency',
        price: 3000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const idempotencyKey = 'concurrent-idem-key';
      const payload = {
        items: [{ productId: prod._id.toString(), quantity: 2 }],
        shippingAddress: validAddress,
      };

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken1}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken1}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // One is 201 (created), other is either 200 (replayed) or 201 (if caught synchronously)
      expect(statuses[0]).toBeGreaterThanOrEqual(200);
      expect(statuses[0]).toBeLessThanOrEqual(201);
      expect(statuses[1]).toBeGreaterThanOrEqual(200);
      expect(statuses[1]).toBeLessThanOrEqual(201);

      // Same order ID returned in both
      expect(res1.body.data._id).toBe(res2.body.data._id);

      // Stock deducted only once (10 - 2 = 8)
      const refreshed = await Product.findById(prod._id);
      expect(refreshed?.stock).toBe(8);

      const count = await Order.countDocuments({ user: customerUser1Id });
      expect(count).toBe(1);
    });
  });

  describe('Order Cancellation & Stock Restoration', () => {
    it('cancel restores stock exactly once; second cancel fails with 400', async () => {
      const prod = await Product.create({
        name: 'Item To Cancel',
        sku: 'CAN-001',
        description: 'Restoration testing item',
        price: 5000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      // Place order for 3 items (stock becomes 7)
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 3 }],
          shippingAddress: validAddress,
        });

      const orderId = orderRes.body.data._id;
      expect((await Product.findById(prod._id))?.stock).toBe(7);

      // Admin cancels order
      const cancelRes1 = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });

      expect(cancelRes1.status).toBe(200);
      expect(cancelRes1.body.data.status).toBe('cancelled');

      // Stock restored to 10
      expect((await Product.findById(prod._id))?.stock).toBe(10);

      // Second cancel attempt -> 400 Bad Request (terminal status)
      const cancelRes2 = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });

      expect(cancelRes2.status).toBe(400);
      expect(cancelRes2.body.message).toMatch(/invalid status transition/i);

      // Stock must NOT be restored a second time (still 10)
      expect((await Product.findById(prod._id))?.stock).toBe(10);
    });

    it('two parallel cancels restore stock once and only one update wins', async () => {
      const prod = await Product.create({
        name: 'Parallel Cancel Item',
        sku: 'PCAN-001',
        description: 'Parallel cancel restoration test',
        price: 4000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 2 }],
          shippingAddress: validAddress,
        });

      const orderId = orderRes.body.data._id;
      expect((await Product.findById(prod._id))?.stock).toBe(3);

      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelled' }),
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelled' }),
      ]);

      const winner = res1.status === 200 ? res1 : res2;
      const loser = res1.status === 200 ? res2 : res1;

      expect(winner.status).toBe(200);
      expect([400, 409]).toContain(loser.status);

      // Stock must be restored exactly once back to 5
      expect((await Product.findById(prod._id))?.stock).toBe(5);

      // Exactly one status transition history entry exists
      const finalOrder = await Order.findById(orderId);
      const transitionEntries = finalOrder?.statusHistory.filter((h) => h.to === 'cancelled');
      expect(transitionEntries).toHaveLength(1);
    });
  });

  describe('Guarded Status Transitions & Concurrency', () => {
    it('rejects invalid status transitions with 400 Bad Request', async () => {
      const prod = await Product.create({
        name: 'Dummy Prod',
        sku: 'DUM-001',
        description: 'Description',
        price: 1000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      const orderId = orderRes.body.data._id;

      // Pending -> Shipped is illegal (must go confirmed -> processing -> shipped)
      const res = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid status transition/i);
    });

    it('concurrent status updates -> exactly one wins, one statusHistory entry created', async () => {
      const prod = await Product.create({
        name: 'Concurrent Transition Prod',
        sku: 'CTRAN-001',
        description: 'Transition test',
        price: 1000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      const orderId = orderRes.body.data._id;

      // Admin 1 tries confirmed, Admin 2 tries cancelled concurrently
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'confirmed', currentStatus: 'pending' }),
        request(app)
          .patch(`/api/v1/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelled', currentStatus: 'pending' }),
      ]);

      const winner = res1.status === 200 ? res1 : res2;
      const loser = res1.status === 200 ? res2 : res1;

      expect(winner.status).toBe(200);
      expect([400, 409]).toContain(loser.status);

      // Verify final statusHistory has exactly one transition from pending
      const finalOrder = await Order.findById(orderId);
      const transitions = finalOrder?.statusHistory.filter(
        (h) => h.from === 'pending' && h.to !== 'pending'
      );
      expect(transitions).toHaveLength(1);
    });
  });

  describe('Order Isolation & Queries', () => {
    it('customer cannot read another customer order (returns 404, not 403)', async () => {
      const prod = await Product.create({
        name: 'Secret Prod',
        sku: 'SEC-001',
        description: 'Owned by customer 1',
        price: 1000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      // Customer 1 places order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      const orderId = orderRes.body.data._id;

      // Customer 2 attempts to fetch Customer 1's order
      const res = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${customerToken2}`);

      // Non-negotiable requirement: 404 Not Found (prevents order enumeration)
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/order not found/i);

      // Admin CAN fetch customer 1's order
      const adminRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data._id).toBe(orderId);
    });

    it('customer GET /orders/my returns only own orders with pagination', async () => {
      const prod = await Product.create({
        name: 'My Prod',
        sku: 'MY-001',
        description: 'For my orders testing',
        price: 1000,
        stock: 20,
        category: testCategory,
        status: 'active',
      });

      // Customer 1 creates 3 orders
      for (let i = 0; i < 3; i++) {
        const orderRes = await request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken1}`)
          .send({
            items: [{ productId: prod._id.toString(), quantity: 1 }],
            shippingAddress: validAddress,
          });
        expect(orderRes.status).toBe(201);
      }

      // Customer 2 creates 1 order
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken2}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      const res = await request(app)
        .get('/api/v1/orders/my')
        .set('Authorization', `Bearer ${customerToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.total).toBe(3);
      expect(
        res.body.data.every((o: { user: string }) => o.user.toString() === customerUser1Id)
      ).toBe(true);
    });

    it('admin GET /orders returns all orders with status and date filtering', async () => {
      const prod = await Product.create({
        name: 'Admin Listing Prod',
        sku: 'ADM-001',
        description: 'For admin listing',
        price: 1000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const o1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      const o2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken2}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      // Confirm order 1
      await request(app)
        .patch(`/api/v1/orders/${o1.body.data._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' });

      // Admin lists only confirmed
      const resConfirmed = await request(app)
        .get('/api/v1/orders?status=confirmed')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resConfirmed.status).toBe(200);
      expect(resConfirmed.body.meta.total).toBe(1);
      expect(resConfirmed.body.data[0]._id).toBe(o1.body.data._id);

      // Admin lists only pending
      const resPending = await request(app)
        .get('/api/v1/orders?status=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resPending.status).toBe(200);
      expect(resPending.body.meta.total).toBe(1);
      expect(resPending.body.data[0]._id).toBe(o2.body.data._id);
    });

    it('filters orders by startDate and date-only endDate including the whole day on customer /my and admin /orders', async () => {
      const prod = await Product.create({
        name: 'Date Test Item',
        sku: `DATE-001-${useTransactions}`,
        description: 'Date filter test',
        price: 1000,
        stock: 10,
        category: testCategory,
        status: 'active',
      });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken1}`)
        .send({
          items: [{ productId: prod._id.toString(), quantity: 1 }],
          shippingAddress: validAddress,
        });

      expect(orderRes.status).toBe(201);
      const createdDate = new Date();
      const todayStr = createdDate.toISOString().slice(0, 10);

      // Customer GET /orders/my with date filter
      const myRes = await request(app)
        .get(`/api/v1/orders/my?startDate=${todayStr}&endDate=${todayStr}`)
        .set('Authorization', `Bearer ${customerToken1}`);

      expect(myRes.status).toBe(200);
      expect(myRes.body.meta.total).toBe(1);

      // Admin GET /orders with date filter
      const adminRes = await request(app)
        .get(`/api/v1/orders?startDate=${todayStr}&endDate=${todayStr}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.meta.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Non-transaction order compensation item isolation', () => {
    it('restores remaining items even when the first item restore throws in compensation mode', async () => {
      const p1 = await Product.create({
        name: 'Comp Item 1',
        sku: `COMP-001-${useTransactions}`,
        description: 'Test product for compensation isolation 1',
        price: 1000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      const p2 = await Product.create({
        name: 'Comp Item 2',
        sku: `COMP-002-${useTransactions}`,
        description: 'Test product for compensation isolation 2',
        price: 2000,
        stock: 5,
        category: testCategory,
        status: 'active',
      });

      // Spy on Product.updateOne to make the first restore call fail
      let callCount = 0;
      const originalUpdateOne = Product.updateOne.bind(Product);
      const spy = jest
        .spyOn(Product, 'updateOne')
        .mockImplementation((...args: Parameters<typeof Product.updateOne>) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Forced updateOne failure during restore');
          }
          return originalUpdateOne(...args);
        });

      // Force Order.create to throw after reservation
      const orderCreateSpy = jest
        .spyOn(Order, 'create')
        .mockRejectedValueOnce(new Error('Forced order create failure'));

      try {
        await expect(
          orderService.createOrder(
            customerUser1Id,
            {
              items: [
                { productId: p1._id.toString(), quantity: 1 },
                { productId: p2._id.toString(), quantity: 1 },
              ],
              shippingAddress: validAddress,
            },
            undefined,
            false // force non-transaction mode
          )
        ).rejects.toThrow('Forced order create failure');

        // At least one of the items should have been restored despite the first failing
        expect(callCount).toBeGreaterThanOrEqual(2);
      } finally {
        spy.mockRestore();
        orderCreateSpy.mockRestore();
      }
    });
  });
});
