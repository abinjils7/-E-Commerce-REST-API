import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { Category } from '../../src/models/category.model';
import { User } from '../../src/models/user.model';
import { env } from '../../src/config/env';

describe('Categories Module Integration Tests', () => {
  const app = createApp();
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    await Category.syncIndexes();
  });

  beforeEach(async () => {
    await Category.deleteMany({});
    await User.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@company.com',
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    const customerUser = await User.create({
      name: 'Customer User',
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

  describe('Public vs Admin RBAC on Category Routes', () => {
    it('allows unauthenticated read access to GET /categories and GET /categories/tree', async () => {
      const treeRes = await request(app).get('/api/v1/categories/tree');
      expect(treeRes.status).toBe(200);
      expect(treeRes.body.success).toBe(true);

      const listRes = await request(app).get('/api/v1/categories');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
    });

    it('denies customer access to category write routes with 403 Forbidden', async () => {
      const createRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Books', slug: 'books' });
      expect(createRes.status).toBe(403);

      const fakeId = new Types.ObjectId().toString();
      const patchRes = await request(app)
        .patch(`/api/v1/categories/${fakeId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Updated' });
      expect(patchRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/api/v1/categories/${fakeId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(deleteRes.status).toBe(403);
    });

    it('denies unauthenticated write operations with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .send({ name: 'Books', slug: 'books' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/categories (4-level hierarchy and validation)', () => {
    it('creates 4 nested levels and accurately sets ancestors array at each level', async () => {
      // Level 1: Root
      const l1Res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Electronics',
          slug: 'electronics',
          description: 'Electronic products',
        });
      expect(l1Res.status).toBe(201);
      const l1 = l1Res.body.data;
      expect(l1.parent).toBeNull();
      expect(l1.ancestors).toEqual([]);

      // Level 2
      const l2Res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Computers',
          slug: 'computers',
          parent: l1._id,
        });
      expect(l2Res.status).toBe(201);
      const l2 = l2Res.body.data;
      expect(l2.parent).toBe(l1._id);
      expect(l2.ancestors).toEqual([l1._id]);

      // Level 3
      const l3Res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Laptops',
          slug: 'laptops',
          parent: l2._id,
        });
      expect(l3Res.status).toBe(201);
      const l3 = l3Res.body.data;
      expect(l3.parent).toBe(l2._id);
      expect(l3.ancestors).toEqual([l1._id, l2._id]);

      // Level 4
      const l4Res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Gaming Laptops',
          slug: 'gaming-laptops',
          parent: l3._id,
        });
      expect(l4Res.status).toBe(201);
      const l4 = l4Res.body.data;
      expect(l4.parent).toBe(l3._id);
      expect(l4.ancestors).toEqual([l1._id, l2._id, l3._id]);
    });

    it('rejects creation if parent category does not exist (400)', async () => {
      const missingId = new Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Orphan Child',
          slug: 'orphan-child',
          parent: missingId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/parent category does not exist/i);
    });

    it('rejects creation if parent category is inactive (400)', async () => {
      const inactiveParent = await Category.create({
        name: 'Inactive Parent',
        slug: 'inactive-parent',
        isActive: false,
      });

      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Active Child',
          slug: 'active-child',
          parent: inactiveParent._id.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/parent category is inactive/i);
    });

    it('allows "Cases" under two different parents, but rejects true sibling duplicate under same parent (409)', async () => {
      // Parent 1: Phones
      const phonesRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Phones', slug: 'phones' });
      expect(phonesRes.status).toBe(201);
      const phonesId = phonesRes.body.data._id;

      // Parent 2: Tablets
      const tabletsRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Tablets', slug: 'tablets' });
      expect(tabletsRes.status).toBe(201);
      const tabletsId = tabletsRes.body.data._id;

      // Create "Cases" under Phones -> 201
      const casesPhonesRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cases', slug: 'cases', parent: phonesId });
      expect(casesPhonesRes.status).toBe(201);

      // Create "Cases" under Tablets -> 201 (scoped to parent, different parents both succeed)
      const casesTabletsRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cases', slug: 'cases', parent: tabletsId });
      expect(casesTabletsRes.status).toBe(201);

      // Create sibling duplicate under Phones -> 409 Conflict
      const dupSiblingRes = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Protective Cases', slug: 'cases', parent: phonesId });
      expect(dupSiblingRes.status).toBe(409);
      expect(dupSiblingRes.body.message).toMatch(/already exists/i);
    });

    it('rejects duplicate sibling name under same parent with 409 Conflict', async () => {
      const parent = await Category.create({
        name: 'Parent Cat',
        slug: 'parent-cat',
      });

      await Category.create({
        name: 'Same Name',
        slug: 'same-name-1',
        parent: parent._id,
        ancestors: [parent._id],
      });

      const res = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Same Name',
          slug: 'same-name-2',
          parent: parent._id.toString(),
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe('GET /api/v1/categories/tree', () => {
    it('returns hierarchical tree structure with correct nesting and child counts', async () => {
      const root1 = await Category.create({ name: 'Electronics', slug: 'electronics' });
      const root2 = await Category.create({ name: 'Home & Kitchen', slug: 'home-kitchen' });
      const child1 = await Category.create({
        name: 'Computers',
        slug: 'computers',
        parent: root1._id,
        ancestors: [root1._id],
      });
      const subChild1 = await Category.create({
        name: 'Laptops',
        slug: 'laptops',
        parent: child1._id,
        ancestors: [root1._id, child1._id],
      });

      const res = await request(app).get('/api/v1/categories/tree');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const tree = res.body.data;
      expect(tree).toHaveLength(2);

      const electronicsNode = tree.find((node: { id: string }) => node.id === root1._id.toString());
      expect(electronicsNode).toBeDefined();
      expect(electronicsNode.children).toHaveLength(1);

      const computersNode = electronicsNode.children[0];
      expect(computersNode.id).toBe(child1._id.toString());
      expect(computersNode.children).toHaveLength(1);

      const laptopsNode = computersNode.children[0];
      expect(laptopsNode.id).toBe(subChild1._id.toString());
      expect(laptopsNode.children).toHaveLength(0);

      const homeNode = tree.find((node: { id: string }) => node.id === root2._id.toString());
      expect(homeNode).toBeDefined();
      expect(homeNode.children).toHaveLength(0);
    });

    it('returns only active categories in the tree', async () => {
      const activeRoot = await Category.create({
        name: 'Active Root',
        slug: 'active-root',
        isActive: true,
      });
      const activeChild = await Category.create({
        name: 'Active Child',
        slug: 'active-child',
        parent: activeRoot._id,
        ancestors: [activeRoot._id],
        isActive: true,
      });

      const inactiveCategory = await Category.create({
        name: 'Inactive Cat',
        slug: 'inactive-cat',
        isActive: false,
      });

      const res = await request(app).get('/api/v1/categories/tree');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const tree = res.body.data;
      const idsInTree = JSON.stringify(tree);
      expect(idsInTree).toContain(activeRoot._id.toString());
      expect(idsInTree).toContain(activeChild._id.toString());
      expect(idsInTree).not.toContain(inactiveCategory._id.toString());
      expect(idsInTree).not.toContain('inactive-cat');
    });
  });

  describe('PATCH /api/v1/categories/:id (category move & cycle rejection)', () => {
    it('rejects self-parenting with 400 Bad Request', async () => {
      const cat = await Category.create({ name: 'Gadgets', slug: 'gadgets' });

      const res = await request(app)
        .patch(`/api/v1/categories/${cat._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: cat._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cycle detected or self-parenting is invalid/i);
    });

    it('rejects cycle moves where parent is set to a descendant (400 Bad Request)', async () => {
      const root = await Category.create({ name: 'Root', slug: 'root' });
      const child = await Category.create({
        name: 'Child',
        slug: 'child',
        parent: root._id,
        ancestors: [root._id],
      });
      const grandchild = await Category.create({
        name: 'Grandchild',
        slug: 'grandchild',
        parent: child._id,
        ancestors: [root._id, child._id],
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${root._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: grandchild._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cycle detected or self-parenting is invalid/i);
    });

    it('moves a subtree and atomically updates all descendants ancestors', async () => {
      const rootA = await Category.create({ name: 'Root A', slug: 'root-a' });
      const rootB = await Category.create({ name: 'Root B', slug: 'root-b' });

      const l2 = await Category.create({
        name: 'L2',
        slug: 'l2',
        parent: rootA._id,
        ancestors: [rootA._id],
      });
      const l3 = await Category.create({
        name: 'L3',
        slug: 'l3',
        parent: l2._id,
        ancestors: [rootA._id, l2._id],
      });
      const l4 = await Category.create({
        name: 'L4',
        slug: 'l4',
        parent: l3._id,
        ancestors: [rootA._id, l2._id, l3._id],
      });

      const moveRes = await request(app)
        .patch(`/api/v1/categories/${l2._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: rootB._id.toString() });

      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.parent).toBe(rootB._id.toString());
      expect(moveRes.body.data.ancestors).toEqual([rootB._id.toString()]);

      const updatedL3 = await Category.findById(l3._id);
      expect(updatedL3).not.toBeNull();
      expect(updatedL3?.parent?.toString()).toBe(l2._id.toString());
      expect(updatedL3?.ancestors.map((id) => id.toString())).toEqual([
        rootB._id.toString(),
        l2._id.toString(),
      ]);

      const updatedL4 = await Category.findById(l4._id);
      expect(updatedL4).not.toBeNull();
      expect(updatedL4?.parent?.toString()).toBe(l3._id.toString());
      expect(updatedL4?.ancestors.map((id) => id.toString())).toEqual([
        rootB._id.toString(),
        l2._id.toString(),
        l3._id.toString(),
      ]);
    });

    it('moves a subcategory to root (parent: null) and updates descendants', async () => {
      const rootA = await Category.create({ name: 'Root A', slug: 'root-a' });
      const l2 = await Category.create({
        name: 'L2',
        slug: 'l2',
        parent: rootA._id,
        ancestors: [rootA._id],
      });
      const l3 = await Category.create({
        name: 'L3',
        slug: 'l3',
        parent: l2._id,
        ancestors: [rootA._id, l2._id],
      });

      const moveRes = await request(app)
        .patch(`/api/v1/categories/${l2._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: null });

      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.parent).toBeNull();
      expect(moveRes.body.data.ancestors).toEqual([]);

      const updatedL3 = await Category.findById(l3._id);
      expect(updatedL3?.ancestors.map((id) => id.toString())).toEqual([l2._id.toString()]);
    });

    it('moves a leaf category cleanly to another parent', async () => {
      const parent1 = await Category.create({ name: 'Parent 1', slug: 'p1' });
      const parent2 = await Category.create({ name: 'Parent 2', slug: 'p2' });
      const leaf = await Category.create({
        name: 'Leaf Node',
        slug: 'leaf-node',
        parent: parent1._id,
        ancestors: [parent1._id],
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${leaf._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: parent2._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.parent).toBe(parent2._id.toString());
      expect(res.body.data.ancestors).toEqual([parent2._id.toString()]);

      const found = await Category.findById(leaf._id);
      expect(found?.parent?.toString()).toBe(parent2._id.toString());
      expect(found?.ancestors.map((a) => a.toString())).toEqual([parent2._id.toString()]);
    });

    it('handles move to same parent as a no-op (200 OK)', async () => {
      const parent = await Category.create({ name: 'Parent', slug: 'parent' });
      const child = await Category.create({
        name: 'Child',
        slug: 'child',
        parent: parent._id,
        ancestors: [parent._id],
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${child._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: parent._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.parent).toBe(parent._id.toString());
      expect(res.body.data.ancestors).toEqual([parent._id.toString()]);
    });

    it('rejects move under an inactive parent with 400 Bad Request', async () => {
      const activeParent = await Category.create({ name: 'Active Parent', slug: 'active-p' });
      const inactiveParent = await Category.create({
        name: 'Inactive Parent',
        slug: 'inactive-p',
        isActive: false,
      });
      const child = await Category.create({
        name: 'Child',
        slug: 'child',
        parent: activeParent._id,
        ancestors: [activeParent._id],
      });

      const res = await request(app)
        .patch(`/api/v1/categories/${child._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ parent: inactiveParent._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/parent category is inactive/i);
    });

    it('rejects rename collision under same parent with 409 Conflict', async () => {
      const parent = await Category.create({ name: 'Parent', slug: 'parent' });
      await Category.create({
        name: 'Sibling A',
        slug: 'sibling-a',
        parent: parent._id,
        ancestors: [parent._id],
      });
      const siblingB = await Category.create({
        name: 'Sibling B',
        slug: 'sibling-b',
        parent: parent._id,
        ancestors: [parent._id],
      });

      // Try renaming sibling B to sibling A's name
      const renameRes = await request(app)
        .patch(`/api/v1/categories/${siblingB._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Sibling A' });

      expect(renameRes.status).toBe(409);
      expect(renameRes.body.message).toMatch(/already exists/i);

      // Try renaming sibling B to sibling A's slug
      const slugRes = await request(app)
        .patch(`/api/v1/categories/${siblingB._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: 'sibling-a' });

      expect(slugRes.status).toBe(409);
      expect(slugRes.body.message).toMatch(/already exists/i);
    });

    it('executes category relocation and descendant updates inside a transaction when USE_TRANSACTIONS=true', async () => {
      process.env.USE_TRANSACTIONS = 'true';

      try {
        const rootA = await Category.create({ name: 'Tx Root A', slug: 'tx-root-a' });
        const rootB = await Category.create({ name: 'Tx Root B', slug: 'tx-root-b' });

        const l2 = await Category.create({
          name: 'Tx L2',
          slug: 'tx-l2',
          parent: rootA._id,
          ancestors: [rootA._id],
        });
        const l3 = await Category.create({
          name: 'Tx L3',
          slug: 'tx-l3',
          parent: l2._id,
          ancestors: [rootA._id, l2._id],
        });

        const res = await request(app)
          .patch(`/api/v1/categories/${l2._id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ parent: rootB._id.toString() });

        expect(res.status).toBe(200);
        expect(res.body.data.parent).toBe(rootB._id.toString());
        expect(res.body.data.ancestors).toEqual([rootB._id.toString()]);

        const updatedL3 = await Category.findById(l3._id);
        expect(updatedL3?.ancestors.map((a) => a.toString())).toEqual([
          rootB._id.toString(),
          l2._id.toString(),
        ]);
      } finally {
        process.env.USE_TRANSACTIONS = 'false';
      }
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('blocks deletion with 409 Conflict when category has active children', async () => {
      const parent = await Category.create({ name: 'Parent', slug: 'parent' });
      await Category.create({
        name: 'Child',
        slug: 'child',
        parent: parent._id,
        ancestors: [parent._id],
      });

      const res = await request(app)
        .delete(`/api/v1/categories/${parent._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/cannot delete category.*child/i);

      const found = await Category.findById(parent._id);
      expect(found).not.toBeNull();
    });

    it('blocks deletion with 409 Conflict when category has inactive children', async () => {
      const parent = await Category.create({
        name: 'Parent With Inactive Child',
        slug: 'p-inactive-child',
      });
      await Category.create({
        name: 'Inactive Child',
        slug: 'inactive-child',
        parent: parent._id,
        ancestors: [parent._id],
        isActive: false,
      });

      const res = await request(app)
        .delete(`/api/v1/categories/${parent._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/cannot delete category.*child/i);

      const found = await Category.findById(parent._id);
      expect(found).not.toBeNull();
    });

    it('deletes leaf category successfully with 200 or 204', async () => {
      const leaf = await Category.create({ name: 'Leaf', slug: 'leaf' });

      const res = await request(app)
        .delete(`/api/v1/categories/${leaf._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 204]).toContain(res.status);

      const found = await Category.findById(leaf._id);
      expect(found).toBeNull();
    });

    it('returns 404 Not Found when deleting non-existent category', async () => {
      const nonExistent = new Types.ObjectId().toString();

      const res = await request(app)
        .delete(`/api/v1/categories/${nonExistent}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/categories (Flat paginated list)', () => {
    it('returns paginated categories with metadata', async () => {
      await Category.create([
        { name: 'Cat A', slug: 'cat-a' },
        { name: 'Cat B', slug: 'cat-b' },
        { name: 'Cat C', slug: 'cat-c' },
      ]);

      const res = await request(app).get('/api/v1/categories?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });
  });

  describe('Category Move Safety & Sibling Collision Pre-check', () => {
    it('forces sibling collision during move and leaves node and descendants unchanged in non-transaction mode', async () => {
      const prevTx = process.env.USE_TRANSACTIONS;
      process.env.USE_TRANSACTIONS = 'false';

      try {
        // Target parent
        const targetParent = await Category.create({
          name: 'Target Parent',
          slug: 'target-parent',
        });
        // Existing sibling under target parent
        await Category.create({
          name: 'Existing Sibling',
          slug: 'existing-sibling',
          parent: targetParent._id,
          ancestors: [targetParent._id],
        });

        // Moving node under root
        const movingNode = await Category.create({ name: 'Moving Node', slug: 'moving-node' });
        // Child of moving node
        const childNode = await Category.create({
          name: 'Child Node',
          slug: 'child-node',
          parent: movingNode._id,
          ancestors: [movingNode._id],
        });

        // Attempt to move movingNode under targetParent with colliding name "Existing Sibling"
        const res = await request(app)
          .patch(`/api/v1/categories/${movingNode._id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            parent: targetParent._id.toString(),
            name: 'Existing Sibling',
          });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already exists/i);

        // Verify movingNode is unchanged
        const freshMoving = await Category.findById(movingNode._id);
        expect(freshMoving?.parent).toBeNull();
        expect(freshMoving?.name).toBe('Moving Node');
        expect(freshMoving?.ancestors).toEqual([]);

        // Verify childNode is unchanged
        const freshChild = await Category.findById(childNode._id);
        expect(freshChild?.ancestors.map((a) => a.toString())).toEqual([movingNode._id.toString()]);
      } finally {
        process.env.USE_TRANSACTIONS = prevTx;
      }
    });
  });
});
