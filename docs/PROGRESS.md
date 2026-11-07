# Project Progress & Status

## System Overview
Production-grade E-Commerce REST API built with Node.js 20+, Express, TypeScript, and MongoDB 7.

### Modules Implemented
- **System**: Health check (`GET /health`) reporting database connection, uptime, and system metadata.
- **Auth & RBAC**: Customer registration (`POST /api/v1/auth/register`), login (`POST /api/v1/auth/login`) with HS256 JWT, dummy bcrypt compare to prevent timing attacks, role verification (`admin`, `customer`), and immediate token revocation on deactivated accounts.
- **Users**: Profile management (`GET/PATCH /api/v1/users/me`), admin paginated user directory (`GET /api/v1/users`), and status toggle (`PATCH /api/v1/users/:id/status`) with self-deactivation protection.
- **Categories**: Materialized path hierarchy (`ancestors`), O(N) in-memory tree builder (`GET /api/v1/categories/tree`), cycle rejection (`detectCycle`), and atomic subtree relocation via single aggregation `updateMany`.
- **Products**: Catalog with `$text` search, recursive descendant category filtering, effective price indexing, inventory tracking, pagination with stable sorting, and guarded admin stock adjustments (`PATCH /api/v1/products/:id/stock`).
- **Orders**: Atomic conditional inventory reservation (`findOneAndUpdate`), backend-authoritative pricing, state machine transitions with cancellation restock, user isolation (404 on foreign access), and idempotency replay via unique partial index.
- **Security & Reliability**: Startup index build (`ensureIndexes()`), NoSQL injection sanitizer, general & auth rate limiting, request ID propagation via `AsyncLocalStorage`, sensitive field and cookie redaction in Pino, and two-phase graceful shutdown.

## How to Run

### Development
```bash
npm install
cp .env.example .env
npm run dev
npm run seed
```

### Production Build
```bash
npm run build
npm start
```

### Docker
```bash
docker compose up --build -d
node scripts/smoke.mjs
```

## Testing & Quality Gates
- **Full Test Suite**: `npm test` runs 13 test suites, **202 / 202 tests passing** (Jest with in-memory replica set).
- **Type Checking**: `npm run typecheck` (`tsc --noEmit`) passes with zero errors.
- **Linting**: `npm run lint` (ESLint 9) passes with zero warnings or errors.
- **Smoke Suite**: `node scripts/smoke.mjs` runs end-to-end verification against live server.

## Known Limitations
1. **Concurrent Category Relocations**: Subtree moves are atomic per transaction, but concurrent moves of mutually interdependent categories can race the pre-write cycle check; distributed locking is recommended for high-concurrency category tree restructurings.
2. **Offset Pagination on Deep Datasets**: Catalog uses indexed `skip`/`limit` pagination; high-scale deployments would benefit from keyset cursor pagination on `(effectivePrice, _id)`.
3. **Session Revocation**: Stateless JWT authorization validates user status from database on each request rather than Redis-backed token blacklisting.
