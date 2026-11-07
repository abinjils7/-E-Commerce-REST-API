# Spec: E-commerce REST API
Source of truth if anything conflicts: docs/ASSIGNMENT.md

## Role and goal
Act as a senior backend engineer. Evaluators grade: API design, multi-level category implementation, database modelling, auth/authorization, order and stock handling, error handling, code structure, code quality. Optimize for correctness and clarity over feature count.

## Stack (fixed)
- Node.js 20+, **Express.js** (not NestJS/Fastify), MongoDB + Mongoose, JWT
- TypeScript
- Zod (validation), bcrypt, helmet, cors, express-rate-limit, express-mongo-sanitize, pino (logging)
- Jest + Supertest + mongodb-memory-server (use MongoMemoryReplSet where transactions are tested)
- Docker + docker-compose (API + Mongo single-node replica set)

## Architecture rules (non-negotiable)
1. Layers: route -> validate (Zod) -> controller -> service -> model.
   - Controllers parse the request and send the response only. They never touch models.
   - Services hold business logic, never touch req/res, and throw AppError.
   - Models hold schema, indexes, and simple invariants only.
2. Structure:
   ```
   src/
     config/       env (validated at startup), db, logger
     modules/      auth, users, categories, products, orders (routes, controller, service, schema)
     models/       user, category, product, order
     middlewares/  authenticate, authorize, validate, errorHandler, notFound, rateLimiter
     utils/        AppError, asyncHandler, pagination, money
     scripts/      seed
     app.ts        builds express app (no listen)
     server.ts     connects DB, listens, graceful shutdown
   tests/
   docs/
   ```
3. One centralized error handler. Map: ZodError -> 422 with field errors; CastError -> 400; Mongo 11000 -> 409; Mongoose ValidationError -> 422; JWT errors -> 401; AppError -> its status; else log and return generic 500. No stack traces in production.
4. Envelope: `{ success, message, data, meta? }` and `{ success:false, message, errors? }`.
5. Prefix `/api/v1`, plural nouns, correct codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.
6. All config from env, validated at startup (exit with a clear message if missing). Keep `.env.example` complete.

## Data model
- **User**: name, email (unique), passwordHash (select:false), role (admin|customer), isActive (default true), timestamps.
- **Category**: name, slug (unique), description, parent (ObjectId|null), ancestors ([ObjectId]), isActive, timestamps.
  Indexes: {ancestors:1}; {parent:1,name:1} unique; {slug:1} unique.
- **Product**: name, sku (unique, uppercase), description, price, salePrice?, effectivePrice (stored = salePrice ?? price), stock (int >= 0), category (ref), status (active|inactive), timestamps.
  Invariants: price >= 0, salePrice <= price.
  Indexes: sku unique; {category:1,status:1,effectivePrice:1}; text(name, description); {createdAt:-1}.
- **Order**: orderNumber (unique), user, items[] snapshot (product, name, sku, unitPrice, quantity, lineTotal), totalAmount, status, statusHistory[] (from, to, by, at), shippingAddress, idempotencyKey?, timestamps.
  Indexes: {user:1,createdAt:-1}; {status:1,createdAt:-1}; {user:1,idempotencyKey:1} unique sparse.
- **Money**: integer minor units (paise). Convert only at the API edge via a `money` util.

## Module requirements

### Auth and users
- POST /auth/register always creates a customer; never accept `role` from the body.
- POST /auth/login returns a JWT (expiry from env). Same generic "Invalid credentials" for unknown email and wrong password.
- `authenticate`: verify token, load user from DB, reject with 403 if !isActive (deactivation is immediate).
- `authorize(...roles)` for RBAC.
- GET/PATCH /users/me (name and password change only).
- Admin: GET /users (paginated, filterable), PATCH /users/:id/status (an admin cannot deactivate themselves).
- Seed script: first admin + sample categories and products.

### Categories (unlimited depth)
- Model: parent reference + ancestors array.
- Create: ancestors = [...parent.ancestors, parent._id]. Parent must exist and be active.
- Update/move: reject if new parent is itself or newParent.ancestors includes the category (cycle). On valid move, update the node, then all descendants in ONE updateMany with an aggregation pipeline (replace old ancestors prefix, keep the tail). Never loop with save().
- Delete: 409 if it has children or products.
- GET /categories (flat, paginated); GET /categories/tree (one query, nested tree built in memory by a pure `buildTree()`).
- Writes admin-only; reads public.

### Products
- Admin: create, update, delete (soft: status=inactive), GET /admin/products (includes inactive). Recompute effectivePrice on every create and update, including findOneAndUpdate paths.
- Customer GET /products: search ($text), category, minPrice, maxPrice (on effectivePrice), sort (whitelist: price_asc, price_desc, newest, name_asc; safe default), page, limit (cap 50).
- Category filter includes ALL descendants: ids = [category, ...find({ancestors: category})], then category: {$in: ids}. Must work at 3+ levels.
- Customers see only active products; out-of-stock items shown with inStock:false.
- Filter building lives in a pure `buildProductQuery()`.
- Response: { data, meta: { total, page, limit, totalPages } }.

### Orders (most important)
POST /orders { items:[{productId, quantity}], shippingAddress }
1. Validate: >= 1 item, quantity integer >= 1, no duplicate productIds (422).
2. Load all products in ONE query; each must exist and be active.
3. Reserve stock per item: findOneAndUpdate({_id, status:'active', stock:{$gte:qty}}, {$inc:{stock:-qty}}). If any returns null, compensate (restore reserved stock) and return 409 naming the item.
4. Prices only from the DB; ignore client prices. Build snapshot and totals in the service.
5. Create the order; if creation fails, compensate.
6. USE_TRANSACTIONS=true wraps steps 3-5 in a Mongo transaction (session passed everywhere); false uses compensation. Both paths work and are tested.
7. Optional Idempotency-Key header (unique per user) prevents duplicate orders on retry.

Status machine (pure `order.status.ts`):
pending -> confirmed|cancelled; confirmed -> processing|cancelled; processing -> shipped|cancelled; shipped -> delivered; delivered and cancelled are terminal.
- Admin PATCH /orders/:id/status uses a guarded update: findOneAndUpdate({_id, status: current}, {status: next, $push: statusHistory}). Null -> 409 (stale). Invalid transition -> 400.
- On cancelled, restore stock with $inc (the guard ensures it happens once).
- Customer: GET /orders/my, GET /orders/:id. Another user's order returns 404, not 403.
- Admin: GET /orders with status/date filters and pagination.

## Security checklist
bcrypt cost 12 (env configurable); helmet; configured CORS; strict rate limit on /auth/* plus a general limit; Zod .strict() schemas (no mass assignment); express-mongo-sanitize; validate every ObjectId (400); JWT secret from env; never log passwords or tokens; never return passwordHash.

## Tests (risk-focused)
- Unit: status transition map, buildTree, buildProductQuery, cycle check, money helpers.
- Integration: customer gets 403 on admin routes; deactivated user blocked with a valid token; register cannot set role.
- Categories: create 4 levels, move subtree (descendants' ancestors correct), reject cycle and self-parent, delete blocked.
- Products: root-category filter returns products from deep descendants.
- Concurrency: stock 5, 10 parallel orders of qty 1 via Promise.all -> exactly 5 succeed, 5 get 409, final stock 0.
- Multi-item order failing on the last item leaves all stock unchanged.
- Customer cannot read another customer's order.
- Concurrent status updates: only one wins.

## Deliverables
Git repo with clean small commits (conventional commits); README.md; .env.example; Postman collection (env variables + login script saving the token, covering every endpoint); Dockerfile (multi-stage, non-root) + docker-compose.yml; GET /health (checks DB); AGENTS.md; CLAUDE.md; docs/PROGRESS.md.
