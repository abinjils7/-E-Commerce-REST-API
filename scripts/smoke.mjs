#!/usr/bin/env node

/**
 * End-to-end smoke test script for E-commerce REST API.
 * Validates system health, admin workflows, catalog operations,
 * atomic concurrent stock reservation, cancellation restocking, and order isolation.
 *
 * Requirements: Node 22, zero external dependencies.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

const pass = (label, detail = '') => {
  console.log(`PASS: ${label}${detail ? ` (${detail})` : ''}`);
};

const fail = (label, error) => {
  console.error(`FAIL: ${label}`);
  if (error) {
    console.error(`  Details:`, error);
  }
  process.exit(1);
};

const request = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    throw new Error(`Fetch failed for ${options.method || 'GET'} ${url}: ${err.message}`);
  }
};

const runSmokeTests = async () => {
  console.log(` Starting smoke tests against ${BASE_URL}...`);

  // 1. GET /health
  try {
    const res = await request('/health');
    if (res.status === 200 && res.data?.data?.database === 'connected') {
      pass('GET /health returned 200 with database connected');
    } else {
      fail('GET /health check failed', JSON.stringify(res));
    }
  } catch (err) {
    fail('GET /health request error', err.message);
  }

  // 2. Admin login
  let adminToken = '';
  try {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (res.status === 200 && res.data?.data?.token) {
      adminToken = res.data.data.token;
      pass('Admin login successful', `email: ${ADMIN_EMAIL}`);
    } else {
      fail('Admin login failed', JSON.stringify(res));
    }
  } catch (err) {
    fail('Admin login error', err.message);
  }

  // 3. Create a category
  let categoryId = '';
  const catTimestamp = Date.now();
  try {
    const res = await request('/api/v1/categories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: `Smoke Category ${catTimestamp}`,
        slug: `smoke-cat-${catTimestamp}`,
        description: 'Temporary category for smoke testing',
      }),
    });
    if (res.status === 201 && res.data?.data?._id) {
      categoryId = res.data.data._id;
      pass('Create category', `id: ${categoryId}`);
    } else {
      fail('Create category failed', JSON.stringify(res));
    }
  } catch (err) {
    fail('Create category error', err.message);
  }

  // 4. Create a product (stock 5, price 250000)
  let productId = '';
  const prodTimestamp = Date.now();
  const smokeSku = `SMOKE-${prodTimestamp}`.toUpperCase();
  const uniqueWord = `Gadget${prodTimestamp}`;
  const smokeProdName = `Smoke Unique ${uniqueWord} Laptop`;
  try {
    const res = await request('/api/v1/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: smokeProdName,
        sku: smokeSku,
        description: 'Smoke test item with stock 5',
        price: 250000,
        stock: 5,
        category: categoryId,
        status: 'active',
      }),
    });
    if (res.status === 201 && res.data?.data?._id) {
      productId = res.data.data._id;
      pass(
        'Create product with stock 5 and price 250000',
        `id: ${productId}, stock: ${res.data.data.stock}`
      );
    } else {
      fail('Create product failed', JSON.stringify(res));
    }

    // 4a. Duplicate product SKU check (verifies products.sku unique index)
    const dupSkuRes = await request('/api/v1/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: `Duplicate SKU Product ${Date.now()}`,
        sku: smokeSku,
        description: 'Should fail due to duplicate SKU index violation',
        price: 150000,
        stock: 1,
        category: categoryId,
        status: 'active',
      }),
    });
    if (dupSkuRes.status === 409) {
      pass('Creating product with duplicate SKU returns 409 (unique index verified)');
    } else {
      fail('Duplicate SKU product creation did not return 409', JSON.stringify(dupSkuRes));
    }

    // 4b. Text search check (verifies products text index on name/description)
    const searchRes = await request(`/api/v1/products?search=${uniqueWord}`);
    const foundProduct =
      Array.isArray(searchRes.data?.data) &&
      searchRes.data.data.find((p) => p.id === productId || p.sku === smokeSku);
    if (searchRes.status === 200 && foundProduct) {
      pass(
        'Text search query returns 200 and includes product (text index verified)',
        `query: ${uniqueWord}`
      );
    } else {
      fail('Text search query did not return 200 or find product', JSON.stringify(searchRes));
    }
  } catch (err) {
    fail('Create product error', err.message);
  }

  // 5. Register and log in a fresh customer with a unique email
  let customerToken = '';
  const customerEmail = `smoke_customer_${Date.now()}@example.com`;
  const customerPassword = 'CustomerPassword123!';
  try {
    const res = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Smoke Customer',
        email: customerEmail,
        password: customerPassword,
      }),
    });
    if (res.status === 201 && res.data?.data?.token) {
      customerToken = res.data.data.token;
      pass('Register customer account', `email: ${customerEmail}`);
    } else {
      fail('Register customer failed', JSON.stringify(res));
    }

    // 5a. Duplicate email registration check (verifies users.email unique index)
    const dupEmailRes = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Duplicate Customer',
        email: customerEmail,
        password: customerPassword,
      }),
    });
    if (dupEmailRes.status === 409) {
      pass('Registering the same email twice returns 409 (unique index verified)');
    } else {
      fail('Duplicate email registration did not return 409', JSON.stringify(dupEmailRes));
    }
  } catch (err) {
    fail('Register customer error', err.message);
  }

  // 6. 12 parallel POST /api/v1/orders of quantity 1 -> exactly 5 x 201 and 7 x 409
  let firstSuccessfulOrderId = '';
  try {
    const orderPayload = {
      items: [
        {
          productId: productId,
          quantity: 1,
        },
      ],
      shippingAddress: {
        fullName: 'Smoke Customer',
        phone: '9876543210',
        line1: '123 Smoke Test Blvd',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
    };

    const orderPromises = Array.from({ length: 12 }, () =>
      request('/api/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify(orderPayload),
      })
    );

    const responses = await Promise.all(orderPromises);
    const count201 = responses.filter((r) => r.status === 201);
    const count409 = responses.filter((r) => r.status === 409);

    if (count201.length === 5 && count409.length === 7) {
      firstSuccessfulOrderId = count201[0].data?.data?._id;
      pass(
        '12 parallel orders for stock 5',
        `5 x 201 Created, 7 x 409 Conflict, order: ${firstSuccessfulOrderId}`
      );
    } else {
      const breakdown = responses.map((r) => r.status).join(', ');
      fail(
        `Order concurrency mismatch (expected 5x201 and 7x409, got: ${breakdown})`,
        JSON.stringify(responses)
      );
    }
  } catch (err) {
    fail('Order concurrency execution error', err.message);
  }

  // 7. Verify product stock is 0 afterwards
  try {
    const res = await request(`/api/v1/products/${productId}`);
    if (res.status === 200 && res.data?.data?.stock === 0) {
      pass('Product stock verified at 0 after 5 reservations');
    } else {
      fail('Product stock was not 0 after orders', `stock: ${res.data?.data?.stock}`);
    }
  } catch (err) {
    fail('Product stock verification error', err.message);
  }

  // 8. Admin PATCH /api/v1/orders/:id/status { status: 'cancelled' } returns 200 and stock becomes 1
  try {
    const patchRes = await request(`/api/v1/orders/${firstSuccessfulOrderId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    if (patchRes.status === 200 && patchRes.data?.data?.status === 'cancelled') {
      pass('Admin cancelled order', `status: ${patchRes.data.data.status}`);
    } else {
      fail('Admin order cancellation failed', JSON.stringify(patchRes));
    }

    const stockRes = await request(`/api/v1/products/${productId}`);
    if (stockRes.status === 200 && stockRes.data?.data?.stock === 1) {
      pass('Product stock restored to 1 upon order cancellation');
    } else {
      fail(
        'Stock was not restored to 1 after cancellation',
        `stock: ${stockRes.data?.data?.stock}`
      );
    }
  } catch (err) {
    fail('Order cancellation and restock verification error', err.message);
  }

  // 9. A second customer GET of that order returns 404
  try {
    const secondEmail = `second_customer_${Date.now()}@example.com`;
    const regRes = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second Customer',
        email: secondEmail,
        password: 'Password123!',
      }),
    });

    if (regRes.status !== 201 || !regRes.data?.data?.token) {
      fail('Register second customer failed', JSON.stringify(regRes));
    }
    const secondToken = regRes.data.data.token;

    const orderRes = await request(`/api/v1/orders/${firstSuccessfulOrderId}`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });

    if (orderRes.status === 404) {
      pass('Customer order isolation enforced: 404 returned for order owned by another user');
    } else {
      fail(
        `Order isolation failed (expected 404, received ${orderRes.status})`,
        JSON.stringify(orderRes)
      );
    }
  } catch (err) {
    fail('Order isolation test error', err.message);
  }

  console.log('\n All smoke tests passed successfully!');
};

runSmokeTests().catch((err) => {
  console.error('Fatal error during smoke test execution:', err);
  process.exit(1);
});
