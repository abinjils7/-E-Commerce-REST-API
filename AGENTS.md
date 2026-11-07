# AGENTS.md

## Project Summary
Production-grade E-commerce REST API built with Node.js, Express, TypeScript, and MongoDB/Mongoose. Focuses on bulletproof architecture, strict layered boundaries, atomic stock handling with concurrency protection, hierarchical tree categories, and RBAC authentication.

## Commands
- `npm run dev`: Start dev server with tsx watch
- `npm run build`: Compile TypeScript to dist/
- `npm start`: Run compiled production build from dist/
- `npm test`: Run full test suite with Jest (in-memory MongoDB)
- `npm run seed`: Populate database with initial admin, categories, and products
- `npm run lint`: Check linting and code formatting
- `npm run typecheck`: Run tsc --noEmit to verify types

## Architecture & Layering Rules
1. Flow: `Route -> Validate (Zod middleware) -> Controller -> Service -> Model`.
2. Controllers: Parse req params/query/body, call services, invoke standard response envelope. Never touch Mongoose models directly. Never contain business logic.
3. Services: Encapsulate all business logic. Throw `AppError` on domain/operational errors. Never access Express `req` or `res`. Pass DB sessions when transactions are active.
4. Models: Define Mongoose schema, validation invariants, and compound/text indexes.
5. Error Handling: Centralized error middleware formats all responses. Maps Zod -> 422, CastError -> 400, duplicate key 11000 -> 409, ValidationError -> 422, JWT errors -> 401, AppError -> status code, unexpected -> 500. Never expose stack traces in production.
6. Envelope standard:
   - Success: `{ "success": true, "message": "...", "data": ..., "meta": ... }`
   - Failure: `{ "success": false, "message": "...", "errors": ... }`
7. Money: Stored as integer minor units (paise). Converted only at the API edge via `money` util.

## Non-Negotiable Domain Rules
- **Prices from DB only**: Never trust client-provided item prices. Compute snapshots and order totals exclusively using fetched active product records.
- **Atomic Stock Reservation**: Reserve stock per item with conditional atomic operation `findOneAndUpdate({ _id, status: 'active', stock: { $gte: qty } }, { $inc: { stock: -qty } })`. Compensate previous items if any item reservation fails.
- **Category Moves**: Validate cycle rejection (category cannot be its own parent or a descendant of itself). Update moving category and descendants in ONE `updateMany` using MongoDB aggregation pipeline. Never loop with `.save()`.
- **Guarded Status Updates**: Transitions must follow state machine: `findOneAndUpdate({ _id, status: current }, { status: next, $push: statusHistory })`. Return 409 if status was concurrently modified. Restock atomically on cancellation.
- **Registration Role Protection**: `POST /auth/register` creates customer accounts only. Role is hardcoded in service; never accept `role` from request body.
- **Order Isolation**: Customer accessing another user's order must return 404 Not Found (not 403) to prevent order ID enumeration.
- **Category Descendants in Search**: Product category filtering must match products in the category and all deep descendants via `{ ancestors: categoryId }`.

## Definition of Done
- Strict TypeScript (`noImplicitAny`, no `any` types).
- All unit and integration tests passing green.
- Clean conventional git commits.
- Zero commented-out code or dangling TODOs.

## Do Nots
- Do NOT touch models from controllers.
- Do NOT bypass atomic conditional updates with read-modify-write loops.
- Do NOT expose `passwordHash` or log tokens/passwords.
- Do NOT return stack traces in production.
- Do NOT accept client-provided prices in order placement.
