import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { User, IUserDocument } from '../../src/models/user.model';
import { env } from '../../src/config/env';

describe('Users Module Integration Tests', () => {
  const app = createApp();
  let adminUser: IUserDocument;
  let customerUser: IUserDocument;
  let adminToken: string;
  let customerToken: string;

  beforeEach(async () => {
    await User.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123!', 10);
    adminUser = await User.create({
      name: 'Admin Chief',
      email: 'admin@company.com',
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    customerUser = await User.create({
      name: 'Customer Dave',
      email: 'dave@company.com',
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

  describe('GET /api/v1/users/me', () => {
    it('returns profile for authenticated user without password or passwordHash', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Customer Dave');
      expect(res.body.data.email).toBe('dave@company.com');
      expect(res.body.data.role).toBe('customer');
      expect(res.body.data).not.toHaveProperty('passwordHash');
      expect(res.body.data).not.toHaveProperty('password');
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('updates user display name', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'David Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('David Updated');

      const updated = await User.findById(customerUser._id);
      expect(updated?.name).toBe('David Updated');
    });

    it('changes password when currentPassword matches', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'BrandNewPassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify login with new password
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'dave@company.com',
        password: 'BrandNewPassword123!',
      });
      expect(loginRes.status).toBe(200);
    });

    it('rejects password change if currentPassword is wrong', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          currentPassword: 'IncorrectPassword!',
          newPassword: 'BrandNewPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Current password is incorrect');
    });
  });

  describe('Admin User Management', () => {
    describe('GET /api/v1/users', () => {
      it('allows admin to list users with pagination, role, and search filters', async () => {
        const res = await request(app)
          .get('/api/v1/users?role=customer&page=1&limit=10')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].email).toBe('dave@company.com');
        expect(res.body.meta).toMatchObject({
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });

        // Ensure passwords are never exposed in user list
        for (const u of res.body.data) {
          expect(u).not.toHaveProperty('passwordHash');
          expect(u).not.toHaveProperty('password');
        }
      });

      it('filters users by search query', async () => {
        const res = await request(app)
          .get('/api/v1/users?search=Dave')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].name).toBe('Customer Dave');
      });
    });

    describe('PATCH /api/v1/users/:id/status', () => {
      it('allows admin to toggle user isActive status', async () => {
        const res = await request(app)
          .patch(`/api/v1/users/${customerUser._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ isActive: false });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(false);

        const dbUser = await User.findById(customerUser._id);
        expect(dbUser?.isActive).toBe(false);
      });

      it('prevents an admin from deactivating themselves', async () => {
        const res = await request(app)
          .patch(`/api/v1/users/${adminUser._id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ isActive: false });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('cannot deactivate themselves');

        const dbAdmin = await User.findById(adminUser._id);
        expect(dbAdmin?.isActive).toBe(true);
      });

      it('returns 400 for invalid ObjectId param', async () => {
        const res = await request(app)
          .patch('/api/v1/users/not-a-valid-id/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ isActive: false });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });
  });
});
