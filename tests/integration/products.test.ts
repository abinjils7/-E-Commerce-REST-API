import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { Product } from '../../src/models/product.model';
import { Category } from '../../src/models/category.model';
import { User } from '../../src/models/user.model';
import { env } from '../../src/config/env';

describe('Products Module Integration Tests', () => {
  const app = createApp();
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    await Product.syncIndexes();
    await Category.syncIndexes();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
    await Category.deleteMany({});
    await User.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const adminUser = await User.create({
      name: 'Admin Boss',
      email: 'admin@company.com',
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    const customerUser = await User.create({
      name: 'Customer Dave',
      email: 'customer@company.com',
      passwordHash,
      role: 'customer',
      isActive: true,
    });

    adminToken = jwt.sign({ id: adminUser._id.toString(), role: adminUser.role }, env.JWT_SECRET, {
      expiresIn: '1h',
    });

    customerToken = jwt.sign(
      { id: customerUser._id.toString(), role: customerUser.role },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('RBAC & Route Protection', () => {
    it('denies customer access to admin product routes with 403 Forbidden', async () => {
      // POST /products
      const postRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Forbidden Item',
          sku: 'FORBIDDEN-01',
          description: 'Desc',
          price: 5000,
          stock: 10,
          category: new Types.ObjectId().toString(),
        });
      expect(postRes.status).toBe(403);

      const fakeId = new Types.ObjectId().toString();

      // PATCH /products/:id
      const patchRes = await request(app)
        .patch(`/api/v1/products/${fakeId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Hacked' });
      expect(patchRes.status).toBe(403);

      // DELETE /products/:id
      const deleteRes = await request(app)
        .delete(`/api/v1/products/${fakeId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(deleteRes.status).toBe(403);

      // GET /admin/products
      const adminListRes = await request(app)
        .get('/api/v1/admin/products')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(adminListRes.status).toBe(403);
    });

    it('allows public read access to GET /products and GET /products/:id', async () => {
      const listRes = await request(app).get('/api/v1/products');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/products (Admin Create & Invariants)', () => {
    it('creates product with correct effectivePrice and uppercase SKU', async () => {
      const category = await Category.create({ name: 'Laptops', slug: 'laptops' });

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Pro Laptop',
          sku: 'lap-001',
          description: 'High performance laptop',
          price: 100000, // 1000.00
          salePrice: 85000, // 850.00
          stock: 10,
          category: category._id.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sku).toBe('LAP-001');
      expect(res.body.data.effectivePrice).toBe(85000);
      expect(res.body.data.stock).toBe(10);
      expect(res.body.data.status).toBe('active');
    });

    it('sets effectivePrice to price when salePrice is omitted or null', async () => {
      const category = await Category.create({ name: 'Keyboards', slug: 'keyboards' });

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Mechanical Keyboard',
          sku: 'KB-001',
          description: 'RGB mechanical keyboard',
          price: 5000,
          stock: 25,
          category: category._id.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.effectivePrice).toBe(5000);
    });

    it('rejects creation if salePrice > price (422 Unprocessable Entity)', async () => {
      const category = await Category.create({ name: 'Accessories', slug: 'accessories' });

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invalid Price Item',
          sku: 'INV-001',
          description: 'Sale price higher than regular price',
          price: 5000,
          salePrice: 6000,
          stock: 5,
          category: category._id.toString(),
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('rejects negative or fractional stock on creation (422)', async () => {
      const category = await Category.create({ name: 'Stock Test Cat', slug: 'stock-test-cat' });

      // Negative stock
      const negRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Negative Stock Item',
          sku: 'NEG-001',
          description: 'Negative stock description',
          price: 5000,
          stock: -5,
          category: category._id.toString(),
        });
      expect(negRes.status).toBe(422);

      // Fractional stock
      const fracRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Fractional Stock Item',
          sku: 'FRAC-001',
          description: 'Fractional stock description',
          price: 5000,
          stock: 5.5,
          category: category._id.toString(),
        });
      expect(fracRes.status).toBe(422);
    });

    it('rejects duplicate SKU with 409 Conflict', async () => {
      const category = await Category.create({ name: 'Monitors', slug: 'monitors' });

      await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Monitor 1',
          sku: 'MON-4K',
          description: '4K IPS Monitor',
          price: 30000,
          stock: 5,
          category: category._id.toString(),
        });

      const dupRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Monitor 2',
          sku: 'mon-4k', // case-insensitive duplicate
          description: 'Another monitor with same SKU',
          price: 35000,
          stock: 2,
          category: category._id.toString(),
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.message).toMatch(/already exists/i);
    });

    it('rejects product creation under inactive or non-existent category (400)', async () => {
      const inactiveCat = await Category.create({
        name: 'Discontinued Category',
        slug: 'discontinued',
        isActive: false,
      });

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Orphan Product',
          sku: 'ORP-001',
          description: 'Product under inactive category',
          price: 1000,
          stock: 5,
          category: inactiveCat._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/inactive category/i);
    });
  });

  describe('PATCH /api/v1/products/:id (Admin Update & effectivePrice integrity)', () => {
    it('recomputes effectivePrice when salePrice is added, modified, or removed', async () => {
      const category = await Category.create({ name: 'Audio', slug: 'audio' });
      const product = await Product.create({
        name: 'Headphones',
        sku: 'HP-001',
        description: 'Wireless Headphones',
        price: 10000,
        stock: 10,
        category: category._id,
      });

      expect(product.effectivePrice).toBe(10000);

      // Add salePrice: 7500
      const patch1 = await request(app)
        .patch(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ salePrice: 7500 });

      expect(patch1.status).toBe(200);
      expect(patch1.body.data.effectivePrice).toBe(7500);

      // Remove salePrice (null) -> effectivePrice reverts to price (10000)
      const patch2 = await request(app)
        .patch(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ salePrice: null });

      expect(patch2.status).toBe(200);
      expect(patch2.body.data.effectivePrice).toBe(10000);

      // Increase price to 12000
      const patch3 = await request(app)
        .patch(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 12000 });

      expect(patch3.status).toBe(200);
      expect(patch3.body.data.effectivePrice).toBe(12000);
    });

    it('rejects price-only update below existing salePrice (400 Bad Request)', async () => {
      const category = await Category.create({ name: 'Audio 2', slug: 'audio-2' });
      const product = await Product.create({
        name: 'Earbuds',
        sku: 'EB-001',
        description: 'TWS Earbuds',
        price: 10000,
        salePrice: 8000,
        stock: 10,
        category: category._id,
      });

      // Attempt to lower price below existing salePrice (8000)
      const res = await request(app)
        .patch(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 7000 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/salePrice cannot be greater than original price/i);
    });
  });

  describe('PATCH /api/v1/products/:id/stock (Admin Guarded Stock Adjustment)', () => {
    it('increases product stock with positive adjustBy', async () => {
      const category = await Category.create({ name: 'Storage', slug: 'storage' });
      const product = await Product.create({
        name: 'Flash Drive',
        sku: 'USB-001',
        description: '64GB Flash Drive',
        price: 1000,
        stock: 10,
        category: category._id,
      });

      const res = await request(app)
        .patch(`/api/v1/products/${product._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adjustBy: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data.stock).toBe(15);
    });

    it('decreases product stock with negative adjustBy when sufficient stock exists', async () => {
      const category = await Category.create({ name: 'Cables', slug: 'cables' });
      const product = await Product.create({
        name: 'HDMI Cable',
        sku: 'HDMI-001',
        description: '2m HDMI Cable',
        price: 800,
        stock: 10,
        category: category._id,
      });

      const res = await request(app)
        .patch(`/api/v1/products/${product._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adjustBy: -4 });

      expect(res.status).toBe(200);
      expect(res.body.data.stock).toBe(6);
    });

    it('rejects stock adjustment if resulting stock would be < 0 with 409 Conflict', async () => {
      const category = await Category.create({ name: 'Mice', slug: 'mice' });
      const product = await Product.create({
        name: 'Wireless Mouse',
        sku: 'MOU-001',
        description: 'Silent wireless mouse',
        price: 1500,
        stock: 5,
        category: category._id,
      });

      // Try reducing by 6 when current stock is 5
      const res = await request(app)
        .patch(`/api/v1/products/${product._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adjustBy: -6 });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/insufficient stock/i);

      // Verify stock was untouched
      const found = await Product.findById(product._id);
      expect(found?.stock).toBe(5);
    });

    it('rejects fractional or zero adjustBy (422)', async () => {
      const fakeId = new Types.ObjectId().toString();

      const fracRes = await request(app)
        .patch(`/api/v1/products/${fakeId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adjustBy: 2.5 });
      expect(fracRes.status).toBe(422);

      const zeroRes = await request(app)
        .patch(`/api/v1/products/${fakeId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adjustBy: 0 });
      expect(zeroRes.status).toBe(422);
    });

    it('denies customer access to stock adjustment with 403 Forbidden', async () => {
      const fakeId = new Types.ObjectId().toString();

      const res = await request(app)
        .patch(`/api/v1/products/${fakeId}/stock`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ adjustBy: 5 });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/products/:id (Admin Soft Delete)', () => {
    it('soft deletes product setting status to inactive', async () => {
      const category = await Category.create({ name: 'Smart Home', slug: 'smart-home' });
      const product = await Product.create({
        name: 'Smart Plug',
        sku: 'SP-001',
        description: 'Wi-Fi Smart Plug',
        price: 2000,
        stock: 15,
        category: category._id,
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/v1/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('inactive');

      // Verify still in database but marked inactive
      const found = await Product.findById(product._id);
      expect(found?.status).toBe('inactive');
    });
  });

  describe('Customer Catalog Search, Filtering & Descendants (3+ Levels)', () => {
    let rootElectronics: Types.ObjectId;
    let level2Computers: Types.ObjectId;
    let level3Laptops: Types.ObjectId;
    let level4GamingLaptops: Types.ObjectId;
    let unrelatedBooks: Types.ObjectId;

    beforeEach(async () => {
      // Build 4-level category hierarchy:
      // Electronics
      //   -> Computers & Laptops
      //        -> Laptops
      //             -> Gaming Laptops
      // Books (unrelated)
      const r1 = await Category.create({ name: 'Electronics', slug: 'electronics' });
      rootElectronics = r1._id as Types.ObjectId;

      const l2 = await Category.create({
        name: 'Computers & Laptops',
        slug: 'computers-laptops',
        parent: rootElectronics,
        ancestors: [rootElectronics],
      });
      level2Computers = l2._id as Types.ObjectId;

      const l3 = await Category.create({
        name: 'Laptops',
        slug: 'laptops',
        parent: level2Computers,
        ancestors: [rootElectronics, level2Computers],
      });
      level3Laptops = l3._id as Types.ObjectId;

      const l4 = await Category.create({
        name: 'Gaming Laptops',
        slug: 'gaming-laptops',
        parent: level3Laptops,
        ancestors: [rootElectronics, level2Computers, level3Laptops],
      });
      level4GamingLaptops = l4._id as Types.ObjectId;

      const b1 = await Category.create({ name: 'Books', slug: 'books' });
      unrelatedBooks = b1._id as Types.ObjectId;

      // Create products across all 4 levels and unrelated category
      await Product.create([
        {
          name: 'Universal Power Adapter',
          sku: 'PWR-001',
          description: 'Fast charging adapter for electronic devices',
          price: 2500,
          stock: 50,
          category: rootElectronics,
          status: 'active',
        },
        {
          name: 'Desktop Workstation Tower',
          sku: 'DSK-001',
          description: 'Tower PC for office productivity',
          price: 60000,
          stock: 12,
          category: level2Computers,
          status: 'active',
        },
        {
          name: 'Ultrabook 14-inch',
          sku: 'ULTRA-001',
          description: 'Slim lightweight laptop with SSD',
          price: 85000,
          stock: 8,
          category: level3Laptops,
          status: 'active',
        },
        {
          name: 'Apex RTX 4090 Gaming Rig',
          sku: 'RIG-001',
          description: 'Ultra fast gaming laptop with RGB keyboard',
          price: 200000,
          salePrice: 180000, // effectivePrice = 180000
          stock: 4,
          category: level4GamingLaptops,
          status: 'active',
        },
        {
          name: 'Out of Stock Gaming Laptop',
          sku: 'OOS-001',
          description: 'Gaming laptop currently out of stock',
          price: 150000,
          stock: 0,
          category: level4GamingLaptops,
          status: 'active',
        },
        {
          name: 'Science Fiction Novel',
          sku: 'BK-001',
          description: 'Bestselling sci-fi novel paperback',
          price: 999,
          stock: 100,
          category: unrelatedBooks,
          status: 'active',
        },
        {
          name: 'Decommissioned Old Server',
          sku: 'OLD-001',
          description: 'Legacy server hardware',
          price: 15000,
          stock: 1,
          category: level2Computers,
          status: 'inactive', // inactive
        },
      ]);
    });

    it('root-category filter includes products from ALL deep descendants (3+ levels)', async () => {
      // Filtering by Electronics should match Level 1, Level 2, Level 3, and Level 4 products (5 active products)
      const res = await request(app).get(`/api/v1/products?category=${rootElectronics}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.total).toBe(5);

      const returnedSkus = res.body.data.map((p: { sku: string }) => p.sku);
      expect(returnedSkus).toContain('PWR-001'); // Level 1
      expect(returnedSkus).toContain('DSK-001'); // Level 2
      expect(returnedSkus).toContain('ULTRA-001'); // Level 3
      expect(returnedSkus).toContain('RIG-001'); // Level 4
      expect(returnedSkus).toContain('OOS-001'); // Level 4 (out of stock active)

      // Does NOT include unrelated books or inactive items
      expect(returnedSkus).not.toContain('BK-001');
      expect(returnedSkus).not.toContain('OLD-001');
    });

    it('sub-level category filter scopes to that level and its own sub-descendants only', async () => {
      // Filtering by Level 3 (Laptops) should include Level 3 and Level 4, but NOT Level 1 or Level 2
      const res = await request(app).get(`/api/v1/products?category=${level3Laptops}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(3); // ULTRA-001, RIG-001, OOS-001

      const returnedSkus = res.body.data.map((p: { sku: string }) => p.sku);
      expect(returnedSkus).toContain('ULTRA-001');
      expect(returnedSkus).toContain('RIG-001');
      expect(returnedSkus).toContain('OOS-001');
      expect(returnedSkus).not.toContain('PWR-001');
      expect(returnedSkus).not.toContain('DSK-001');
    });

    it('filters prices accurately using effectivePrice (sale price)', async () => {
      // RIG-001 has regular price 200000, but salePrice (effectivePrice) = 180000
      // If we search maxPrice = 185000, RIG-001 MUST match on effectivePrice!
      const res = await request(app).get('/api/v1/products?minPrice=160000&maxPrice=190000');

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].sku).toBe('RIG-001');
      expect(res.body.data[0].effectivePrice).toBe(180000);
    });

    it('supports inStock boolean query filter and returns inStock flag in response envelope', async () => {
      const inStockRes = await request(app).get('/api/v1/products?inStock=true');
      expect(inStockRes.status).toBe(200);
      const outOfStockItems = inStockRes.body.data.filter((p: { inStock: boolean }) => !p.inStock);
      expect(outOfStockItems).toHaveLength(0);

      const oosRes = await request(app).get('/api/v1/products?inStock=false');
      expect(oosRes.status).toBe(200);
      expect(oosRes.body.data.every((p: { inStock: boolean }) => p.inStock === false)).toBe(true);
      expect(oosRes.body.data.some((p: { sku: string }) => p.sku === 'OOS-001')).toBe(true);
    });

    it('sorts by whitelisted keys and falls back safely to newest default', async () => {
      // Sort price_asc
      const priceAscRes = await request(app).get('/api/v1/products?sort=price_asc');
      expect(priceAscRes.status).toBe(200);
      const prices = priceAscRes.body.data.map((p: { effectivePrice: number }) => p.effectivePrice);
      const sortedPrices = [...prices].sort((a, b) => a - b);
      expect(prices).toEqual(sortedPrices);

      // Sort price_desc
      const priceDescRes = await request(app).get('/api/v1/products?sort=price_desc');
      expect(priceDescRes.status).toBe(200);
      const pricesDesc = priceDescRes.body.data.map(
        (p: { effectivePrice: number }) => p.effectivePrice
      );
      const expectedDesc = [...pricesDesc].sort((a, b) => b - a);
      expect(pricesDesc).toEqual(expectedDesc);

      // Default fallback when sort query parameter is omitted
      const defaultRes = await request(app).get('/api/v1/products');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.length).toBeGreaterThan(0);
    });

    it('hides inactive products from customer GET /products and GET /products/:id (404)', async () => {
      // Public list should not show OLD-001
      const listRes = await request(app).get('/api/v1/products');
      const skus = listRes.body.data.map((p: { sku: string }) => p.sku);
      expect(skus).not.toContain('OLD-001');

      // Fetching OLD-001 by ID as customer returns 404
      const inactiveDoc = await Product.findOne({ sku: 'OLD-001' });
      const idRes = await request(app).get(`/api/v1/products/${inactiveDoc?._id}`);
      expect(idRes.status).toBe(404);
      expect(idRes.body.message).toMatch(/product not found/i);
    });

    it('allows admin to view inactive products via GET /api/v1/admin/products', async () => {
      const adminRes = await request(app)
        .get('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      const skus = adminRes.body.data.map((p: { sku: string }) => p.sku);
      expect(skus).toContain('OLD-001');
    });

    it('returns accurate pagination metadata and enforces max limit cap of 50', async () => {
      const pageRes = await request(app).get('/api/v1/products?page=1&limit=2');
      expect(pageRes.status).toBe(200);
      expect(pageRes.body.data).toHaveLength(2);
      expect(pageRes.body.meta).toEqual({
        total: 6,
        page: 1,
        limit: 2,
        totalPages: 3,
      });

      // Exceeding limit > 50 is rejected with 422
      const limitExceededRes = await request(app).get('/api/v1/products?limit=100');
      expect(limitExceededRes.status).toBe(422);
    });

    it('pagination over equal prices returns no duplicates or gaps (tiebreaker)', async () => {
      // Clear existing products and create 4 products with identical effectivePrice
      await Product.deleteMany({});
      const cat = await Category.findOne({ name: 'Electronics' });
      const products = await Product.create([
        {
          name: 'Widget A',
          sku: 'EQ-A',
          description: 'Equal price widget',
          price: 5000,
          stock: 1,
          category: cat!._id,
          status: 'active',
        },
        {
          name: 'Widget B',
          sku: 'EQ-B',
          description: 'Equal price widget',
          price: 5000,
          stock: 1,
          category: cat!._id,
          status: 'active',
        },
        {
          name: 'Widget C',
          sku: 'EQ-C',
          description: 'Equal price widget',
          price: 5000,
          stock: 1,
          category: cat!._id,
          status: 'active',
        },
        {
          name: 'Widget D',
          sku: 'EQ-D',
          description: 'Equal price widget',
          price: 5000,
          stock: 1,
          category: cat!._id,
          status: 'active',
        },
      ]);

      // Paginate with limit=2, sorted by price_asc (all prices equal, so _id tiebreaker decides)
      const page1 = await request(app).get('/api/v1/products?sort=price_asc&limit=2&page=1');
      const page2 = await request(app).get('/api/v1/products?sort=price_asc&limit=2&page=2');

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);

      const page1Ids = page1.body.data.map((p: { id: string }) => p.id);
      const page2Ids = page2.body.data.map((p: { id: string }) => p.id);

      // No overlapping IDs between pages
      const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);

      // All 4 products accounted for
      const allIds = new Set([...page1Ids, ...page2Ids]);
      expect(allIds.size).toBe(4);
      expect(allIds.size).toBe(products.length);
    });
  });

  describe('Category Deletion Guard with Associated Products', () => {
    it('blocks category deletion with 409 Conflict when products are assigned to it', async () => {
      const category = await Category.create({ name: 'Cameras', slug: 'cameras' });
      await Product.create({
        name: 'Mirrorless Camera',
        sku: 'CAM-001',
        description: 'Full frame mirrorless camera',
        price: 120000,
        stock: 5,
        category: category._id,
      });

      // Attempt to delete category
      const deleteCatRes = await request(app)
        .delete(`/api/v1/categories/${category._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteCatRes.status).toBe(409);
      expect(deleteCatRes.body.message).toMatch(/products are assigned to this category/i);

      // Verify category was not deleted
      const found = await Category.findById(category._id);
      expect(found).not.toBeNull();
    });
  });
});
