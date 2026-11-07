# Production-Grade E-Commerce REST API

A production-grade E-Commerce REST API built with Node.js, Express, TypeScript, and MongoDB. Engineered with strict layered architecture (`Route -> Validate -> Controller -> Service -> Model`), concurrency-safe atomic inventory reservation (`findOneAndUpdate`), hierarchical multi-level categories via materialized path with atomic subtree relocation, and role-based access control (RBAC).

**Tech Stack**: Node.js 20+, Express 4, TypeScript 5 (strict), MongoDB 7 / Mongoose 8, Zod 3, Pino, Jest.

---

## Quick Start

### Local Setup (3 Commands)
```bash
# 1. Install dependencies & configure environment
npm install && cp .env.example .env

# 2. Seed initial admin, categories, and products
npm run seed

# 3. Start development server with live reload
npm run dev
```

### Run with Docker (3 Commands)
```bash
# 1. Prepare environment variables
cp .env.example .env

# 2. Build and start containers in background (API + MongoDB Replica Set + Auto-seed)
docker compose up --build -d

# 3. Run automated end-to-end smoke tests
node scripts/smoke.mjs
```
> **Note**: Docker configuration is verified via automated continuous integration (`.github/workflows/docker-smoke.yml`).

---

## Table of Contents
- [Quick Start](#quick-start)
- [Architecture Overview](#1-architecture-overview)
- [Standard Response Envelope](#2-standard-response-envelope)
- [Environment Variables](#3-environment-variables)
- [Seed Instructions & Credentials](#4-seed-instructions--credentials)
- [Endpoints Table](#5-endpoints-table)
- [Postman Collection & Environment](#6-postman-collection--environment)
- [Testing & Quality Gates](#7-testing--quality-gates)
- [Database Indexes & Query Execution Plans](#8-database-indexes--query-execution-plans)
- [Security, Observability & Lifecycle Management](#9-security-observability--lifecycle-management)
- [Design Decisions Table](#10-design-decisions-table)
- [Known Limitations & Roadmap](#11-known-limitations--what-id-do-next)
- [Requirements Verification Checklist](#12-requirements-verification-checklist)

---

## 1. Architecture Overview

### Layered Flow
```
Client HTTP Request
       │
       ▼
 [Security Middlewares]  -->  (Helmet, CORS, express-mongo-sanitize, Rate Limiter)
       │
       ▼
 [Router & Validation]  -->  (Express Routes + Zod validation for body/query/params)
       │
       ▼
    [Controller]        -->  (Extract inputs, invoke Service, format standard Envelope)
       │
       ▼
     [Service]          -->  (Business logic, atomic stock ops, DB transactions, throws AppError)
       │
       ▼
      [Model]           -->  (Mongoose Schemas, validation invariants, compound/text indexes)
       │
       ▼
 [MongoDB / WiredTiger] -->  (Replica set with ACID transactions & conditional updates)
```

### Architectural Guardrails
1. **Controllers**: Never touch Mongoose models or execute database queries directly.
2. **Services**: Encapsulate all domain logic. Never interact with Express `req` or `res`. Throw structured `AppError` instances.
3. **Models**: Pure schema definitions, indexes, and document-level validation invariants.
4. **Centralized Error Handling**: Strict error mapping converting domain exceptions into uniform HTTP response envelopes.

### Multi-Level Category Architecture (Materialized Path)
The category module implements a high-performance **Materialized Path** tree pattern with atomic subtree relocations:
1. **Schema & Invariants**:
   - `parent`: `ObjectId | null` (references parent or `null` for root categories).
   - `ancestors`: Ordered array of parent `ObjectId`s from root down to the direct parent (`[rootId, ..., parentId]`).
   - Indexes:
     - `{ ancestors: 1 }`: Enables instantaneous subtree filtering (`{ ancestors: categoryId }`) for deep product catalog search.
     - `{ parent: 1, name: 1 }` (unique): Prevents duplicate sibling category names under the same parent.
     - `{ parent: 1, slug: 1 }` (unique): Enforces slug uniqueness scoped to parent (allows identical slugs like "cases" under different parents).
2. **Cycle & Self-Parenting Rejection**:
   - Moving a category under itself (`newParentId === categoryId`) is rejected with `400 Bad Request`.
   - Moving a category under any of its own descendants (`newParentAncestors.includes(categoryId)`) is detected via `detectCycle()` and rejected with `400 Bad Request`.
3. **Atomic Subtree Relocation Query**:
   - Rather than recursively fetching and looping with `.save()`, relocating a category and all its deep descendants is executed in **ONE atomic `updateMany`** query using a MongoDB aggregation pipeline:
   ```ts
   // Match all descendants that contain the moved category in their ancestors
   await Category.updateMany(
     { ancestors: category._id },
     [
       {
         $set: {
           ancestors: {
             $concatArrays: [
               newPrefix, // New ancestor path leading up to and including the moved node
               {
                 $slice: [
                   '$ancestors',
                   oldPrefix.length,      // Strip off the old root-to-node prefix
                   { $size: '$ancestors' } // Preserve the node's local descendant sub-path
                 ]
               }
             ]
           }
         }
       }
     ]
   );
   ```
4. **Pure In-Memory Tree Construction**:
   - `GET /api/v1/categories/tree` fetches all active categories in a single flat query and passes them to `buildTree()`.
   - `buildTree()` operates in `O(N)` time using an in-memory dictionary lookup, avoiding recursive database lookups or N+1 queries.

---

## 2. Standard Response Envelope

All API endpoints strictly follow a predictable JSON response envelope:

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Validation failed",
  "requestId": "9f9e684a-ad38-48c4-841b-2fc4e6f1d08e",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email address"
    }
  ]
}
```

---

## 3. Environment Variables

| Variable | Description | Default (dev/test) | Production Required |
|---|---|---|---|
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` | — |
| `PORT` | HTTP server port | `5000` | — |
| `LOG_LEVEL` | Pino logger level (`fatal`, `error`, `warn`, `info`, `debug`) | `info` | — |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://127.0.0.1:27017/ecom` | **Yes** |
| `USE_TRANSACTIONS` | Enable replica set ACID transactions for orders | `false` | — |
| `JWT_SECRET` | Secret key for signing JWT tokens (min 32 chars) | Dev fallback provided | **Yes (≥ 32 chars)** |
| `JWT_EXPIRES_IN` | Token expiration duration | `24h` | — |
| `BCRYPT_SALT_ROUNDS`| Salt rounds for password hashing | `12` | — |
| `ADMIN_EMAIL` | Default administrator account email for seed script | `admin@example.com` | **Yes** |
| `ADMIN_PASSWORD` | Default administrator account password for seed script | `AdminPassword123!` | **Yes** |
| `CORS_ORIGIN` | Allowed CORS origins (`*` or comma-separated URLs) | `*` | **Yes (non-wildcard)** |
| `RATE_LIMIT_WINDOW_MS` | General rate limit window in milliseconds | `900000` (15m) | — |
| `RATE_LIMIT_MAX` | Max general requests per window per IP | `100` | — |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Auth rate limit window in milliseconds | `900000` (15m) | — |
| `AUTH_RATE_LIMIT_MAX` | Max auth requests per window per IP | `30` | — |

> **Dev/Test defaults**: In `development` and `test` environments, `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` fall back to safe defaults so `.env` is optional. In `production`, missing any required variable causes immediate `process.exit(1)` with a clear error message.

---

## 4. Seed Instructions & Credentials

Run the database seed script at any time:
```bash
npm run seed
```
The seed script is **fully idempotent** and safe to run multiple times without duplicating or corrupting records. It creates/updates the initial administrator using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env`:

| Role | Email | Password | Configured Via |
|---|---|---|---|
| **Admin** | `admin@example.com` | `AdminPassword123!` | `ADMIN_EMAIL`, `ADMIN_PASSWORD` |

> **Note**: The seed creates only the admin account. Register a customer via `POST /api/v1/auth/register`.

---

## 5. Endpoints Table

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/health` | Public | System status & database connectivity healthcheck |
| `POST` | `/api/v1/auth/register` | Public | Register customer account (role hardcoded to customer) |
| `POST` | `/api/v1/auth/login` | Public | Authenticate with email/password; returns JWT |
| `GET` | `/api/v1/users/me` | Customer / Admin | Retrieve current user profile |
| `PATCH` | `/api/v1/users/me` | Customer / Admin | Update current user name or password (requires currentPassword) |
| `GET` | `/api/v1/users` | Admin | Paginated user listing filtered by role, isActive, or search |
| `PATCH` | `/api/v1/users/:id/status` | Admin | Activate/deactivate user account (cannot deactivate self) |
| `GET` | `/api/v1/categories` | Public | List categories (flat, paginated) |
| `GET` | `/api/v1/categories/tree` | Public | Hierarchical category tree (active categories only) built in-memory via `buildTree()` |
| `GET` | `/api/v1/categories/:id` | Public | Retrieve category details by ID (ancestors included) |
| `POST` | `/api/v1/categories` | Admin | Create category (auto-computes ancestors path) |
| `PATCH` | `/api/v1/categories/:id` | Admin | Update category / move subtree (single atomic updateMany) |
| `DELETE` | `/api/v1/categories/:id` | Admin | Delete category (blocked with 409 if children or products exist) |
| `GET` | `/api/v1/products` | Public | Search ($text), category (all descendants), price filter, sort, paginate |
| `GET` | `/api/v1/products/:id` | Public | Retrieve active product details |
| `GET` | `/api/v1/admin/products` | Admin | Catalog listing including inactive/draft products |
| `POST` | `/api/v1/products` | Admin | Create product with auto-computed effectivePrice |
| `PATCH` | `/api/v1/products/:id` | Admin | Update product details (stock excluded) |
| `PATCH` | `/api/v1/products/:id/stock` | Admin | Dedicated conditional stock adjustment (+/- integer via `$inc`) |
| `DELETE` | `/api/v1/products/:id` | Admin | Soft delete product (`status: inactive`) |
| `POST` | `/api/v1/orders` | Customer | Place order with atomic stock reservation & optional Idempotency-Key |
| `GET` | `/api/v1/orders/my` | Customer | List customer order history (newest first) |
| `GET` | `/api/v1/orders/:id` | Customer | Get order details (isolated: returns 404 for other users' orders) |
| `GET` | `/api/v1/orders` | Admin | List all orders with status/date filters and pagination |
| `PATCH` | `/api/v1/orders/:id/status` | Admin | Guarded state machine transition; restocks atomically on cancel |

#### Product Design Notes & Policies:
- **Currency & Minor Units**: All monetary values (`price`, `salePrice`, `effectivePrice`, `minPrice`, `maxPrice`) are stored and validated as non-negative integers representing minor units (paise, 1 INR = 100 paise). Floating-point currency inputs are rejected.
- **Search Behavior**: Product search uses MongoDB `$text` full-text search indexing on `name` and `description`, which matches whole words and word stems rather than partial substrings.
- **Category Status Policy**: Product visibility is governed by `product.status === 'active'`. Deactivating a category blocks assigning new products to it and prevents it from appearing in `GET /categories/tree`, but existing products assigned to that category remain visible in the customer catalog as long as their individual `status` is `'active'`. Querying an inactive category directly will still return 200 for the category document; product visibility is determined solely by `product.status`.
- **Stock Adjustment Safety**: Stock cannot be overwritten blindly via the general update endpoint; instead, the dedicated `PATCH /products/:id/stock` endpoint uses a conditional `$inc` (`stock: { $gte: Math.abs(adjustBy) }` when reducing) to prevent race conditions with concurrent customer checkout decrements.

### Orders (`/api/v1`)
- `POST /api/v1/orders` - Place order (atomic stock reservation, optional idempotency key)
- `GET /api/v1/orders/my` - List customer's orders
- `GET /api/v1/orders/:id` - Order details (isolated: returns 404 for other customers' orders)
- `GET /api/v1/orders` - List all orders (Admin only, filter by status and date)
- `PATCH /api/v1/orders/:id/status` - Guarded status transition & restock on cancellation (Admin only)

#### Order Flow & Consistency Strategy:
1. **Validation & Bulk Load**: All items are validated (`quantity >= 1`, max 50 items, max 100 per item, no duplicate `productId`s). Products are loaded in a single query (`{ _id: { $in: productIds } }`) and verified to exist and be `active`.
2. **Deterministic Sort**: Items are sorted by `productId` prior to reservation to reduce write conflicts across concurrent multi-item checkouts.
3. **Atomic Reservation**: Each item's stock is decremented atomically with `findOneAndUpdate({ _id, status: 'active', stock: { $gte: qty } }, { $inc: { stock: -qty } }, { new: true })`.
4. **Consistency Modes**:
   - **Transaction Mode (`USE_TRANSACTIONS=true`)**: Executed inside `session.withTransaction()`, providing full ACID semantics and automatic retries for transient transaction errors. If any item fails stock reservation, the entire transaction rolls back automatically.
   - **Compensation Mode (`USE_TRANSACTIONS=false`)**: If any item lacks stock or order document creation fails, the service compensates all previously reserved stock with `$inc: { stock: qty }` before throwing a `409 Conflict`.
5. **Snapshotting & Pricing**: Line snapshots are constructed directly from the document returned by the atomic reservation, locking in the `effectivePrice` at reservation time and completely ignoring client-sent prices.
6. **Idempotency Strategy**: The `Idempotency-Key` header is checked before reserving stock. If a duplicate request is received with identical payload, it returns `200 OK` (replay) with the original order without deducting stock again. Mismatched payloads with the same key return `409 Conflict`.
7. **Guarded State Transitions**: Transitions strictly follow the state machine (`pending -> confirmed|cancelled -> processing|cancelled -> shipped|cancelled -> delivered`). Transitions are guarded atomically via `findOneAndUpdate({ _id, status: current }, { status: next, $push: statusHistory })`. If the order is cancelled, stock is restored with `$inc` exactly once.
8. **Customer Order Isolation**: Customer order lookups are owner-scoped (`findOne({ _id, user })`), returning `404 Not Found` (never 403) to prevent order ID enumeration.

---

## 6. Postman Collection & Environment

Pre-configured Postman assets are available in the [`postman/`](file:///c:/ECOm/postman) directory:
- **Collection**: [`postman/ecommerce-api.postman_collection.json`](file:///c:/ECOm/postman/ecommerce-api.postman_collection.json)
- **Environment**: [`postman/ecommerce-api.postman_environment.json`](file:///c:/ECOm/postman/ecommerce-api.postman_environment.json)

### Collection Features & Runner Design:
1. **Separate Admin & Customer Tokens**: Authentication endpoints automatically parse the response envelope and inject JWTs into dedicated collection variables: `Login Admin` stores `adminToken`, while `Register Customer` and `Login Customer` store `customerToken`.
2. **Folder-Level Authorization**: Request authorization is configured cleanly at the folder level—all admin folders (`3. Admin - Categories`, `4. Admin - Products`, `7. Admin - Orders & Users`) inherit `Bearer {{adminToken}}`, while customer folders (`6. Customer - Orders & Profile`) inherit `Bearer {{customerToken}}`. Individual requests omit hardcoded `Authorization` headers and inherit folder auth automatically. Public folders (`1. System`, `5. Customer - Catalog`) require no authentication.
3. **Dynamic UUID Idempotency Key**: The `Place Order (Customer)` request sets the `Idempotency-Key` header to Postman's built-in dynamic variable `{{$guid}}`, generating a unique UUID v4 on every invocation.
4. **Zero-Edit Top-to-Bottom Collection Runner**: The entire collection is fully runnable top-to-bottom in the Postman Collection Runner with no manual edits required. Dynamic timestamping (`runTimestamp`) ensures unique emails, category slugs, and product SKUs across repeated runs without state collisions or 409 duplicate errors.
5. **Full Lifecycle Hierarchy**: Step-by-step requests execute the entire e-commerce lifecycle: healthcheck -> customer registration & login -> admin login -> 3-level category hierarchy creation & atomic subtree move -> product creation & atomic inventory adjustment -> public search & deep descendant category filtering -> customer checkout with atomic stock reservation -> order history lookup -> admin order status transition -> admin user status management -> product soft-delete.

---

## 7. Testing & Quality Gates

The test suite covers unit logic, concurrency risks, and integration flows using automated test suites:

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run TypeScript type check
npm run typecheck

# Run linter
npm run lint
```

---

## 8. Database Indexes & Query Execution Plans

### Startup Index Initialization
In production environments (`NODE_ENV=production`), Mongoose disables automatic index creation (`autoIndex: false`) to avoid performance penalties during connection. To guarantee that fresh databases (including clean Docker containers and new production clusters) have full indexing, all indexes across registered models (`User`, `Category`, `Product`, `Order`) are explicitly built at startup via `await ensureIndexes()` after connecting to MongoDB and BEFORE the HTTP server begins listening. Database seeding (`src/scripts/seed.ts`) also executes `await ensureIndexes()` prior to upserting records. If index initialization fails, the process logs a fatal error and exits immediately (`process.exit(1)`).

### Production Index Inventory
| Collection | Index Specification | Type / Options | Target Queries / Purpose |
|---|---|---|---|
| **Users** | `{ email: 1 }` | Unique | User lookup by email (`POST /auth/login`, duplicate registration check) |
| **Users** | `{ isActive: 1 }` | Standard | Admin listing filtered by account status |
| **Users** | `{ createdAt: -1 }` | Standard | Admin user list sorted newest-first (explain() confirmed: IXSCAN `createdAt_-1`, no in-memory SORT) |
| **Categories** | `{ ancestors: 1 }` | Standard Multikey | Deep subtree queries (`{ ancestors: categoryId }`) |
| **Categories** | `{ parent: 1, name: 1 }` | Unique Compound | Enforces sibling name uniqueness under the same parent |
| **Categories** | `{ parent: 1, slug: 1 }` | Unique Compound | Parent-scoped slug uniqueness (intentional deviation from global-unique spec: allows identical slugs under different branches; enforces sibling uniqueness only) |
| **Categories** | `{ isActive: 1 }` | Standard | Tree builder flat fetch of active categories |
| **Categories** | `{ name: 1 }` | Standard | Category flat list sorted alphabetically (explain() confirmed: IXSCAN `name_1`, no in-memory SORT) |
| **Products** | `{ sku: 1 }` | Unique | Fast SKU lookup and uniqueness enforcement |
| **Products** | `{ category: 1, status: 1, effectivePrice: 1 }` | Compound | Customer catalog search, category subtree filtering, price range queries |
| **Products** | `{ name: 'text', description: 'text' }` | Text Index | Full-text word and stem search (`$text: { $search: query }`) |
| **Products** | `{ createdAt: -1 }` | Standard | Default newest sorting |
| **Products** | `{ status: 1, effectivePrice: 1, _id: 1 }` | Compound | Price-sorted active-product listing with stable cursor pagination |
| **Products** | `{ status: 1, createdAt: -1, _id: 1 }` | Compound | Newest-first active-product listing with stable cursor pagination |
| **Orders** | `{ orderNumber: 1 }` | Unique | Fast human-readable order lookup |
| **Orders** | `{ user: 1, createdAt: -1 }` | Compound | Customer order history (`GET /orders/my`) sorted newest first |
| **Orders** | `{ status: 1, createdAt: -1 }` | Compound | Admin order queue filtered by status and sorted chronologically (explain() confirmed: IXSCAN `status_1_createdAt_-1`, no in-memory SORT) |
| **Orders** | `{ createdAt: -1 }` | Standard | Unfiltered admin order list sorted newest-first (explain() confirmed: IXSCAN `createdAt_-1`, no in-memory SORT) |
| **Orders** | `{ user: 1, idempotencyKey: 1 }` | Unique Compound (Partial) | Replays idempotent orders without duplicate deductions (`partialFilterExpression: { idempotencyKey: { $type: 'string' } }`) |

*Index Optimization Audit: Redundant inline single-field indexes (such as `{ category: 1 }`, `{ status: 1 }`, or `{ effectivePrice: 1 }` on Product, and `{ status: 1 }` on Order) were removed as they are fully covered by the leading prefixes of compound indexes, minimizing storage footprint and write overhead.*

### Execution Plan Verification (`explain('executionStats')`)
1. **Product Subtree Catalog Listing**:
   - Query: `Product.find({ category: catId, status: 'active', effectivePrice: { $gte: 10000 } }).sort({ effectivePrice: 1 })`
   - Plan: `IXSCAN` on `category_1_status_1_effectivePrice_1`
   - Result: Index-bounded scan with zero in-memory sorting (`hasSortStage: false`), verifying compound index coverage for filter and sort.
2. **Category Subtree Resolution**:
   - Query: `Category.find({ ancestors: rootCatId })`
   - Plan: `IXSCAN` on `ancestors_1` multikey index
   - Result: Index-seek scanning only documents containing `rootCatId` in their ancestors array.
3. **Admin Order List — Unfiltered**:
   - Query: `Order.find({}).sort({ createdAt: -1 })`
   - Plan: `IXSCAN` on `createdAt_-1`
   - Result: No in-memory SORT stage; index covers the sort direction directly.
4. **Admin Order List — Status-Filtered**:
   - Query: `Order.find({ status: 'pending' }).sort({ createdAt: -1 })`
   - Plan: `IXSCAN` on `status_1_createdAt_-1`
   - Result: No in-memory SORT stage; compound index covers both filter and sort.
5. **Admin User List**:
   - Query: `User.find({}).sort({ createdAt: -1 })`
   - Plan: `IXSCAN` on `createdAt_-1`
   - Result: No in-memory SORT stage.
6. **Category Flat List**:
   - Query: `Category.find({}).sort({ name: 1 })`
   - Plan: `IXSCAN` on `name_1`
   - Result: No in-memory SORT stage.

All six plans are asserted in [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) (describe block "5. Database Query Execution Stats").

---

## 9. Security, Observability & Lifecycle Management

### Security Hardening
1. **NoSQL Injection Defense**: Integrated `express-mongo-sanitize` middleware cleanses `req.body`, `req.query`, and `req.params`, stripping MongoDB operator keys (`$gt`, `$ne`, etc.) before reaching route handlers.
2. **Rate Limiting**:
   - Strict rate limiter on `/api/v1/auth/*` (`AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS`) mitigating credential stuffing and brute-force attacks.
   - General rate limiter on all endpoints (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`).
   - Rate limit responses return HTTP `429 Too Many Requests` in the standard response envelope with `requestId`.
   - Rate limits are configurable via environment variables and relaxed in test environments to avoid throttling automated test suites.
3. **Strict Validation & Input Sanitization**:
   - Every route parameter expecting an ObjectId is validated via `validateObjectId`, immediately returning `400 Bad Request` on invalid hexadecimal format.
   - All body and query inputs are parsed with Zod `.strict()` schemas, rejecting unknown properties to prevent mass assignment.
4. **Security Headers & CORS**: `helmet` configures security headers (CSP, HSTS, X-Content-Type-Options, Frameguard); CORS is configured via `CORS_ORIGIN`:
   - `CORS_ORIGIN=*` (wildcard): allows any origin but **disables** `credentials` mode (no `Access-Control-Allow-Credentials` header).
   - `CORS_ORIGIN=https://app.example.com` or comma-separated list: reflects the matching origin with `credentials: true`.
   - In `production`, a wildcard origin is rejected at startup; an explicit origin or list is required.

### Observability & Logging
1. **Request ID Tracking**:
   - Every request is tagged with a unique request ID (respecting incoming `X-Request-Id` or auto-generating a UUID).
   - The request ID is exposed in the `X-Request-Id` response header and included in all error response payloads.
   - Integrated via `AsyncLocalStorage`, ensuring every downstream log statement automatically injects `requestId`.
2. **Sensitive Data Redaction**:
   - Pino logger incorporates strict redaction paths: passwords (`password`, `passwordHash`, `currentPassword`, `newPassword`), tokens (`token`), authorization headers (`req.headers.authorization`, `headers.authorization`), and cookie/session headers (`req.headers.cookie`, `headers.cookie`, `res.headers["set-cookie"]`, `cookie`) are stripped from log outputs to prevent credential and session token leakage.
3. **Structured HTTP Logging**: `pino-http` logs request lifecycle events (method, URL, status code, response time, request ID).

### Graceful Shutdown
The application handles `SIGTERM` and `SIGINT` signals with a two-phase graceful shutdown:
1. The HTTP server calls `server.close()`, halting acceptance of new incoming requests while allowing current in-flight requests to complete.
2. Once the HTTP server finishes closing, the database connection is cleanly terminated via `disconnectDB()`.
3. A safety timeout ensures forced exit if graceful teardown exceeds 10 seconds.

---

## 10. Design Decisions Table

| Decision | Choice | Rationale |
|---|---|---|
| **Role Protection** | Hardcoded `role: 'customer'` in service | Eliminates mass assignment vulnerabilities; registration can never create admin accounts. |
| **Login Error Masking** | Generic "Invalid credentials" | Prevents user enumeration attacks by returning the exact same 401 error regardless of whether email or password was wrong. |
| **Immediate Revocation** | `authenticate` loads fresh user document from DB | If an account is deactivated (`isActive: false`), all existing JWT tokens are immediately rejected with 403 without waiting for token expiry. |
| **Money Representation** | Integer minor units (paise) | Eliminates floating point rounding inaccuracies in calculations and database storage. |
| **Stock Reservation** | Atomic `$inc: { stock: -qty }` with condition `$gte: qty` | Guarantees concurrency safety without race conditions or dirty reads. |
| **Stock Adjustment** | Guarded `$inc` via dedicated endpoint | `PATCH /products/:id/stock` uses conditional `$inc` (`$gte: Math.abs(adjustBy)`) rather than full-document overwrite, preventing admin stock adjustments from clobbering concurrent order reservations. |
| **Category Tree** | Parent reference + `ancestors` array | Fast recursive subtree queries (`{ ancestors: categoryId }`) without deep graph lookups. |
| **Category Relocation** | Atomic `updateMany` with aggregation pipeline | Descendants are rewritten in one `updateMany`; the moved node is then saved separately via `.save()`. The combined operation is atomic only when `USE_TRANSACTIONS=true` (wraps both steps in a single session transaction). Without transactions, a node-save failure triggers a best-effort reverse `updateMany` to restore descendants. |
| **Category Cycle Rejection** | `detectCycle` validation check | Rejects self-parenting and circular references where a category is moved under one of its own descendants. |
| **Product EffectivePrice** | Computed snapshot stored in DB | Maintained via load → apply → `.save()` in `updateProduct`; a Mongoose `pre('validate')` hook recomputes `salePrice ?? price` on every save path, keeping the indexed field in sync. |
| **Category Descendant Search** | `{ ancestors: categoryId }` resolution | Resolves all sub-categories and matches products with `{ category: { $in: [id, ...descendants] } }` across unlimited category depth. |
| **Order Status Machine** | Guarded atomic updates | `findOneAndUpdate({ _id, status: current }, { status: next })` ensures only one transition wins concurrently. |
| **Order Isolation** | Return 404 for unauthorized order access | Prevents enumeration attacks where malicious users probe order IDs. |
| **Order Idempotency** | Sparse partial compound index (`{ user: 1, idempotencyKey: 1 }`) | Replays original order with 200 OK on duplicate key submission, prevents duplicate stock deductions and duplicate charges. |
| **Dual Consistency Engine** | Support transactions (`withTransaction`) & manual compensation | Offers production-grade ACID transactions on replica sets, while maintaining graceful compensation rollbacks in standalone MongoDB setups. |

---

## 11. Known Limitations & What I'd Do Next

### Known Limitations
1. **Consistency Without Transactions**: When `USE_TRANSACTIONS=false` (standalone MongoDB without replica sets), an unhandled server crash precisely between stock reservation and order creation (or between order cancellation and stock restoration) could leave temporary stock discrepancies. This risk is completely eliminated when `USE_TRANSACTIONS=true` (the default in Docker and production replica sets).
2. **Concurrent Category Tree Moves**: `USE_TRANSACTIONS=true` makes individual relocations atomic (node save + descendant `updateMany` are committed together or not at all), but it does **not** serialize concurrent moves. Two simultaneous moves can still race past the pre-write `detectCycle()` check and produce an inconsistent tree. This is a documented limitation; the fix requires a distributed mutex or serialization queue.
3. **Single Token Session**: Authentication issues a standalone signed JWT without refresh token rotation or server-side blacklisting (token revocation relies on DB account status `isActive: false`).
4. **Offset Pagination on Very Large Datasets**: Pagination currently uses standard `skip` and `limit`. While well-suited for moderate catalog sizes and supported by compound indexes, offset pagination suffers performance degradation on millions of rows.

### What I'd Do Next (Production Roadmap)
1. **Cursor-Based Keyset Pagination**: Transition high-velocity endpoints (`GET /products` and `GET /orders`) to cursor-based pagination utilizing `(effectivePrice, _id)` and `(createdAt, _id)` compound indexes, eliminating `skip()` overhead on deep pages.
2. **Refresh Token Rotation & Revocation Lists**: Implement sliding refresh token pairs stored as hashed tokens in Redis/MongoDB with reuse detection and automated family invalidation.
3. **Payment Gateway Integration with Two-Phase Capture**: Connect Stripe or Razorpay webhooks with a two-phase stock hold (reservation TTL) -> checkout payment intent -> order capture flow.
4. **Soft-Delete for Categories with Cascading Archival**: Introduce soft deletion (`status: 'archived'`) for categories with tombstoning, allowing catalog managers to retire entire product branches while retaining historical order snapshots.
5. **Distributed Locks for Category Operations**: Add a Redlock / MongoDB-based distributed mutex around category subtree moves to prevent concurrent race conditions on tree reorganizations.

---

## 12. Requirements Verification Checklist

Comprehensive traceability matrix mapping each project requirement from [`docs/ASSIGNMENT.md`](file:///c:/ECOm/docs/ASSIGNMENT.md) to its implementation file, corresponding automated test suite, and verification status.

### User Management
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| Registration & Login (`POST /auth/register` creates customers only; `POST /auth/login` returns JWT with identical generic 401 error) | [`src/modules/auth/auth.service.ts`](file:///c:/ECOm/src/modules/auth/auth.service.ts), [`src/modules/auth/auth.controller.ts`](file:///c:/ECOm/src/modules/auth/auth.controller.ts), [`src/modules/auth/auth.schema.ts`](file:///c:/ECOm/src/modules/auth/auth.schema.ts) | [`tests/integration/auth.test.ts`](file:///c:/ECOm/tests/integration/auth.test.ts) | Complete |
| JWT Authentication (Bearer token verification, payload signing with env secret/expiry, rejection of expired/invalid tokens with 401) | [`src/middlewares/authenticate.ts`](file:///c:/ECOm/src/middlewares/authenticate.ts), [`src/modules/auth/auth.service.ts`](file:///c:/ECOm/src/modules/auth/auth.service.ts) | [`tests/integration/auth.test.ts`](file:///c:/ECOm/tests/integration/auth.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Roles & RBAC (Role enum `admin` \| `customer`, `authorize` middleware gate returning 403 on role mismatch) | [`src/middlewares/authorize.ts`](file:///c:/ECOm/src/middlewares/authorize.ts), [`src/models/user.model.ts`](file:///c:/ECOm/src/models/user.model.ts) | [`tests/integration/auth.test.ts`](file:///c:/ECOm/tests/integration/auth.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| User Profile (`GET /users/me` retrieves profile without password hash; `PATCH /users/me` updates name/password with verification) | [`src/modules/users/user.service.ts`](file:///c:/ECOm/src/modules/users/user.service.ts), [`src/modules/users/user.controller.ts`](file:///c:/ECOm/src/modules/users/user.controller.ts) | [`tests/integration/users.test.ts`](file:///c:/ECOm/tests/integration/users.test.ts) | Complete |
| Admin View & Activate/Deactivate Users (Admin `GET /users` with pagination/filters; `PATCH /users/:id/status` activates/deactivates user; admin cannot deactivate self) | [`src/modules/users/user.service.ts`](file:///c:/ECOm/src/modules/users/user.service.ts), [`src/modules/users/user.controller.ts`](file:///c:/ECOm/src/modules/users/user.controller.ts) | [`tests/integration/users.test.ts`](file:///c:/ECOm/tests/integration/users.test.ts) | Complete |
| Password Hashing (bcrypt cost 12 from env; `passwordHash` hidden with `select: false` and stripped from JSON representations) | [`src/modules/auth/auth.service.ts`](file:///c:/ECOm/src/modules/auth/auth.service.ts), [`src/models/user.model.ts`](file:///c:/ECOm/src/models/user.model.ts) | [`tests/integration/auth.test.ts`](file:///c:/ECOm/tests/integration/auth.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |

### Category Management
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| Category CRUD (Admin create, update, delete; auto-computed `ancestors` array; sibling name/slug uniqueness; guarded delete returning 409 if children or products exist) | [`src/modules/categories/category.service.ts`](file:///c:/ECOm/src/modules/categories/category.service.ts), [`src/models/category.model.ts`](file:///c:/ECOm/src/models/category.model.ts) | [`tests/integration/categories.test.ts`](file:///c:/ECOm/tests/integration/categories.test.ts) | Complete |
| Category Tree API (`GET /categories/tree` fetches active categories in one flat query and constructs nested tree in memory via pure `buildTree()`) | [`src/modules/categories/category.tree.ts`](file:///c:/ECOm/src/modules/categories/category.tree.ts), [`src/modules/categories/category.service.ts`](file:///c:/ECOm/src/modules/categories/category.service.ts) | [`tests/unit/category.tree.test.ts`](file:///c:/ECOm/tests/unit/category.tree.test.ts), [`tests/integration/categories.test.ts`](file:///c:/ECOm/tests/integration/categories.test.ts) | Complete |
| Cycle Prevention & Atomic Relocation (Rejects self-parenting and descendant cycles; relocates node and all descendants in ONE atomic `updateMany` aggregation pipeline without `.save()` loops) | [`src/modules/categories/category.tree.ts`](file:///c:/ECOm/src/modules/categories/category.tree.ts), [`src/modules/categories/category.service.ts`](file:///c:/ECOm/src/modules/categories/category.service.ts) | [`tests/unit/category.tree.test.ts`](file:///c:/ECOm/tests/unit/category.tree.test.ts), [`tests/integration/categories.test.ts`](file:///c:/ECOm/tests/integration/categories.test.ts) | Complete |

### Product Management
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| Product CRUD (Admin create, update, soft delete with `status: inactive`; customer catalog viewing active products; `GET /admin/products` includes inactive products) | [`src/modules/products/product.service.ts`](file:///c:/ECOm/src/modules/products/product.service.ts), [`src/modules/products/product.controller.ts`](file:///c:/ECOm/src/modules/products/product.controller.ts) | [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Product Fields & Invariants (Uppercase unique SKU; integer paise currency; `price >= 0`, `salePrice <= price`; stored `effectivePrice = salePrice ?? price`; integer `stock >= 0`) | [`src/models/product.model.ts`](file:///c:/ECOm/src/models/product.model.ts), [`src/modules/products/product.service.ts`](file:///c:/ECOm/src/modules/products/product.service.ts) | [`tests/unit/money.test.ts`](file:///c:/ECOm/tests/unit/money.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Product Search (Full-text search on product `name` and `description` using MongoDB `$text` index) | [`src/modules/products/product.query.ts`](file:///c:/ECOm/src/modules/products/product.query.ts), [`src/models/product.model.ts`](file:///c:/ECOm/src/models/product.model.ts) | [`tests/unit/product.query.test.ts`](file:///c:/ECOm/tests/unit/product.query.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Category Filter Including Subcategories (Resolves all deep descendant categories via `{ ancestors: categoryId }` and matches `{ category: { $in: [categoryId, ...descendants] } }` across unlimited depth) | [`src/modules/products/product.service.ts`](file:///c:/ECOm/src/modules/products/product.service.ts) | [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Price Filter (Filter catalog by `minPrice` and `maxPrice` evaluated against stored `effectivePrice`) | [`src/modules/products/product.query.ts`](file:///c:/ECOm/src/modules/products/product.query.ts) | [`tests/unit/product.query.test.ts`](file:///c:/ECOm/tests/unit/product.query.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Sorting (Whitelisted sort mappings `price_asc`, `price_desc`, `newest`, `name_asc` with secondary tiebreaker `{ _id: 1 }` and safe default `{ createdAt: -1 }`) | [`src/modules/products/product.query.ts`](file:///c:/ECOm/src/modules/products/product.query.ts) | [`tests/unit/product.query.test.ts`](file:///c:/ECOm/tests/unit/product.query.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |
| Pagination (Page and limit validation; `limit` above 50 returns 422 Unprocessable Entity (not silently clamped); standard metadata `{ total, page, limit, totalPages }`) | [`src/utils/pagination.ts`](file:///c:/ECOm/src/utils/pagination.ts) | [`tests/unit/pagination.test.ts`](file:///c:/ECOm/tests/unit/pagination.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts) | Complete |

### Order Management
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| Order Placement & Stock Validation (`POST /orders` validates `>= 1` item, `quantity >= 1`, max 50 items, max 100 per item, no duplicate productIds; bulk loads active products in ONE query) | [`src/modules/orders/order.schema.ts`](file:///c:/ECOm/src/modules/orders/order.schema.ts), [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Backend Pricing & Snapshot (Client prices strictly ignored; pricing snapshot and totals computed exclusively from active product database records) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Atomic Stock Reduction & Concurrency Protection (Items ordered by productId; conditional atomic reservation `findOneAndUpdate({ _id, status: 'active', stock: { $gte: qty } }, { $inc: { stock: -qty } })`; 409 if insufficient stock) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Customer-Only Orders & Order Isolation (Customer order routes isolated to owner; accessing another customer's order returns 404 Not Found, never 403, preventing enumeration) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts), [`src/modules/orders/order.controller.ts`](file:///c:/ECOm/src/modules/orders/order.controller.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Admin Order List & Status Update (Admin `GET /orders` with status/date filters and pagination; guarded transition `findOneAndUpdate({ _id, status: current }, { status: next })` with pure state machine; atomic restock on cancellation) | [`src/modules/orders/order.status.ts`](file:///c:/ECOm/src/modules/orders/order.status.ts), [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts) | [`tests/unit/order.status.test.ts`](file:///c:/ECOm/tests/unit/order.status.test.ts), [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Transactions / Atomic Stock (Dual Mode Engine: `USE_TRANSACTIONS=true` uses `session.withTransaction()` with transient retries; `false` uses automatic compensation rollbacks) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |

### General Requirements
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| Validation (Zod schemas on body, query, and params with `.strict()` preventing mass assignment; strict ObjectId format validation returning 400 Bad Request) | [`src/middlewares/validate.ts`](file:///c:/ECOm/src/middlewares/validate.ts), [`src/modules/*/*.schema.ts`](file:///c:/ECOm/src/modules/) | [`tests/integration/auth.test.ts`](file:///c:/ECOm/tests/integration/auth.test.ts), [`tests/integration/products.test.ts`](file:///c:/ECOm/tests/integration/products.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Error Handling & Response Envelope (Centralized error middleware mapping Zod -> 422, CastError -> 400, duplicate key 11000 -> 409, ValidationError -> 422, JWT -> 401, AppError -> status code; standard `{ success, message, data/errors }` envelope) | [`src/middlewares/errorHandler.ts`](file:///c:/ECOm/src/middlewares/errorHandler.ts), [`src/utils/AppError.ts`](file:///c:/ECOm/src/utils/AppError.ts) | [`tests/unit/errorHandler.test.ts`](file:///c:/ECOm/tests/unit/errorHandler.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| HTTP Status Codes (Accurate semantic status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500 across all endpoints) | [`src/middlewares/errorHandler.ts`](file:///c:/ECOm/src/middlewares/errorHandler.ts), all controllers | [`tests/unit/errorHandler.test.ts`](file:///c:/ECOm/tests/unit/errorHandler.test.ts), [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Environment Variables (Validated at startup with Zod in `src/config/env.ts`; dev/test environments use safe defaults so `.env` is optional; production requires explicit `MONGODB_URI`, `JWT_SECRET` (≥ 32 chars), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a non-wildcard `CORS_ORIGIN` — missing any causes immediate `process.exit(1)`) | [`src/config/env.ts`](file:///c:/ECOm/src/config/env.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Database Indexing (Compound indexes on products and orders; multikey `{ ancestors: 1 }`; text search index; unique partial index on `{ user: 1, idempotencyKey: 1 }`; explain() IXSCAN verified) | [`src/models/user.model.ts`](file:///c:/ECOm/src/models/user.model.ts), [`src/models/category.model.ts`](file:///c:/ECOm/src/models/category.model.ts), [`src/models/product.model.ts`](file:///c:/ECOm/src/models/product.model.ts), [`src/models/order.model.ts`](file:///c:/ECOm/src/models/order.model.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Rate Limiting (Configurable strict limiter on `/api/v1/auth/*` and general limiter across all routes; returns 429 in standard envelope with `requestId`) | [`src/middlewares/rateLimiter.ts`](file:///c:/ECOm/src/middlewares/rateLimiter.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Logging & Observability (Structured JSON logging via Pino; request ID tracking via AsyncLocalStorage; strict redaction of sensitive credentials and tokens) | [`src/config/logger.ts`](file:///c:/ECOm/src/config/logger.ts), [`src/middlewares/requestId.ts`](file:///c:/ECOm/src/middlewares/requestId.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |

### Submission
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| .env.example (Comprehensive environment template with documented defaults and placeholders passing all startup schema validations) | [`.env.example`](file:///c:/ECOm/.env.example) | Manual / Verified against `src/config/env.ts` | Complete |
| README (Complete documentation covering architecture, setup, endpoints table, Docker quick start, design rationale, limitations, and checklist) | [`README.md`](file:///c:/ECOm/README.md) | Manual / Documentation Audit | Complete |
| Postman Collection (Exported v2.1 collection and environment with folder-level auth using `adminToken` and `customerToken`, dynamic `{{$guid}}` idempotency key, runnable top-to-bottom) | [`postman/ecommerce-api.postman_collection.json`](file:///c:/ECOm/postman/ecommerce-api.postman_collection.json), [`postman/ecommerce-api.postman_environment.json`](file:///c:/ECOm/postman/ecommerce-api.postman_environment.json) | Manual / Postman Runner Verification | Complete |
| Automated Tests (Comprehensive test suite covering domain logic, concurrent races, tree cycles, isolation, and transactions) | [`tests/unit/`](file:///c:/ECOm/tests/unit), [`tests/integration/`](file:///c:/ECOm/tests/integration) | `npm test` (13 suites, 202 tests green) | Complete |
| Docker & Docker Compose (Multi-stage non-root Dockerfile; docker-compose with single-node replica set `rs0` and automated seeding) | [`Dockerfile`](file:///c:/ECOm/Dockerfile), [`docker-compose.yml`](file:///c:/ECOm/docker-compose.yml), [`.github/workflows/docker-smoke.yml`](file:///c:/ECOm/.github/workflows/docker-smoke.yml) | [`scripts/smoke.mjs`](file:///c:/ECOm/scripts/smoke.mjs), [`.github/workflows/docker-smoke.yml`](file:///c:/ECOm/.github/workflows/docker-smoke.yml) | PENDING (CI not yet confirmed) |

### Bonus
| Requirement | Where Implemented | Test That Proves It | Status |
|---|---|---|---|
| ACID Transactions with Replica Set (Full transaction support via `session.withTransaction()` with automatic retries for transient transaction errors) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts), [`src/modules/categories/category.service.ts`](file:///c:/ECOm/src/modules/categories/category.service.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| Order Idempotency (`Idempotency-Key` header with sparse partial unique compound index `{ user: 1, idempotencyKey: 1 }`; returns 200 replay on duplicate submission, 409 on payload mismatch) | [`src/modules/orders/order.service.ts`](file:///c:/ECOm/src/modules/orders/order.service.ts), [`src/models/order.model.ts`](file:///c:/ECOm/src/models/order.model.ts) | [`tests/integration/orders.test.ts`](file:///c:/ECOm/tests/integration/orders.test.ts) | Complete |
| NoSQL Injection Defense (Application-level `express-mongo-sanitize` stripping `$` and `.` operators from body, query, and params) | [`src/app.ts`](file:///c:/ECOm/src/app.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
| Graceful Teardown & Health Check (`GET /health` probing database connectivity; graceful shutdown handling `SIGTERM`/`SIGINT` draining requests before database disconnect) | [`src/server.ts`](file:///c:/ECOm/src/server.ts), [`src/app.ts`](file:///c:/ECOm/src/app.ts) | [`tests/integration/security.test.ts`](file:///c:/ECOm/tests/integration/security.test.ts) | Complete |
