import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { User } from '../../src/models/user.model';
import { env } from '../../src/config/env';

describe('Auth & RBAC Integration Tests', () => {
  const app = createApp();

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates a customer successfully', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Alice Customer',
        email: 'alice@example.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('alice@example.com');
      expect(res.body.data.user.role).toBe('customer');
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.user.password).toBeUndefined();

      // Verify DB record
      const dbUser = await User.findOne({ email: 'alice@example.com' });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.role).toBe('customer');
    });

    it('rejects client-provided role and always creates customer', async () => {
      // Body schema has .strict(), so passing 'role' causes 422 error
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Malicious Attacker',
        email: 'attacker@example.com',
        password: 'Password123!',
        role: 'admin',
      });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);

      // Verify attacker was not created
      const count = await User.countDocuments({ email: 'attacker@example.com' });
      expect(count).toBe(0);
    });

    it('returns 409 when registering with an existing email', async () => {
      await User.create({
        name: 'Existing User',
        email: 'existing@example.com',
        passwordHash: 'hashed_pw',
        role: 'customer',
        isActive: true,
      });

      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Another User',
        email: 'existing@example.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already exists');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      const passwordHash = await bcrypt.hash('SecurePass123!', 10);
      await User.create({
        name: 'Valid Customer',
        email: 'valid@example.com',
        passwordHash,
        role: 'customer',
        isActive: true,
      });

      await User.create({
        name: 'Inactive Customer',
        email: 'inactive@example.com',
        passwordHash,
        role: 'customer',
        isActive: false,
      });
    });

    it('returns identical generic "Invalid credentials" message for unknown email and wrong password', async () => {
      // 1. Unknown email
      const resUnknown = await request(app).post('/api/v1/auth/login').send({
        email: 'unknown@example.com',
        password: 'WrongPassword!',
      });

      // 2. Wrong password for existing email
      const resWrongPw = await request(app).post('/api/v1/auth/login').send({
        email: 'valid@example.com',
        password: 'WrongPassword!',
      });

      expect(resUnknown.status).toBe(401);
      expect(resWrongPw.status).toBe(401);
      expect(resUnknown.body.message).toBe('Invalid credentials');
      expect(resWrongPw.body.message).toBe('Invalid credentials');
      expect(resUnknown.body.message).toBe(resWrongPw.body.message);
    });

    it('performs dummy bcrypt compare when email is unknown to prevent timing attacks', async () => {
      const compareSpy = jest.spyOn(bcrypt, 'compare');
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'nonexistent-user-timing-test@example.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
      expect(compareSpy).toHaveBeenCalled();
      compareSpy.mockRestore();
    });

    it('returns JWT token on valid credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'valid@example.com',
        password: 'SecurePass123!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('valid@example.com');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
      expect(res.body.data.user).not.toHaveProperty('password');
    });

    it('returns 403 when deactivated user attempts to login', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'inactive@example.com',
        password: 'SecurePass123!',
      });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('deactivated');
    });
  });

  describe('Authentication & Authorization Middlewares', () => {
    it('blocks deactivated user even with a valid JWT token (immediate revocation)', async () => {
      const user = await User.create({
        name: 'Deactivated User',
        email: 'deactivated@example.com',
        passwordHash: 'hashed',
        role: 'customer',
        isActive: false,
      });

      const validToken = jwt.sign({ id: user._id.toString(), role: user.role }, env.JWT_SECRET, {
        expiresIn: '1h',
      });

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('deactivated');
    });

    it('returns 401 when token is missing or malformed', async () => {
      const resNoToken = await request(app).get('/api/v1/users/me');
      expect(resNoToken.status).toBe(401);

      const resBadHeader = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'InvalidFormat 123');
      expect(resBadHeader.status).toBe(401);
    });

    it('returns 403 when customer tries to access admin-only route', async () => {
      const customer = await User.create({
        name: 'Customer Bob',
        email: 'bob@example.com',
        passwordHash: 'hashed',
        role: 'customer',
        isActive: true,
      });

      const token = jwt.sign({ id: customer._id.toString(), role: 'customer' }, env.JWT_SECRET, {
        expiresIn: '1h',
      });

      const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });
  });
});
