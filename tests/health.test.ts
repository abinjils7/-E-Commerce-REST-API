import request from 'supertest';
import { createApp } from '../src/app';

describe('Health Check Endpoint', () => {
  const app = createApp();

  it('GET /health returns 200 when database is connected', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Service healthy',
      data: {
        status: 'healthy',
        database: 'connected',
      },
    });
    expect(res.body.data.uptime).toBeDefined();
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('GET /api/v1/non-existent-route returns 404', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      message: 'Route not found: GET /api/v1/non-existent-route',
    });
  });
});
