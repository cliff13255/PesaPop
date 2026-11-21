# PesaPop API

Express + TypeScript + Prisma backend for PesaPop, matching [`../docs/openapi.yaml`](../docs/openapi.yaml).
Database: Supabase Postgres, reached only from this server.

## Status

| Phase | Area | State |
|-------|------|-------|
| 1 | Config, auth (`/auth/register`, `/auth/login`, `/me`), middleware, Prisma models, seed, tests | Done |
| 2 | Payment drafts, idempotent confirm, `/payments/{id}`, `/transactions`, `/merchant/summary`, `/payment-requests` | Done |
| 3 | `/assistant/messages` (Claude), PayHero STK Push, Lipwa links, `/webhooks/payhero` | Not started |

Until Phase 3, payments use a **stub provider**: confirm creates a `pending` payment, logs
`(no money moved)`, and the payment stays `pending`. It never reports success. Payment
requests get `link: null`.

## Setup

```bash
cd api
npm install
cp .env.example .env          # fill in JWT_SECRET, DATABASE_URL, DIRECT_URL, CORS_ORIGINS
npm run db:deploy             # apply migrations (uses DIRECT_URL)
npm run db:seed               # customer@pesapop.test / merchant@pesapop.test, password from SEED_PASSWORD
npm run dev                   # http://localhost:3000
```

Supabase connection strings (Project Settings -> Database):
- `DATABASE_URL`: the **pooled** string (port 6543), with `?pgbouncer=true&connection_limit=1`.
- `DIRECT_URL`: the **direct/session** string (port 5432). Prisma Migrate needs it.

The Supabase keys and the database password live only in `.env`. No endpoint returns them, and
`src/config/env.ts` prints variable names (never values) if validation fails.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run with reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run typecheck` | Type-check only |
| `npm test` | Vitest + Supertest against a real Postgres (see below) |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations (deploys) |
| `npm run db:seed` | Seed the demo customer and merchant |

## Tests

Tests need a **throwaway** Postgres database. They truncate every table. Never point them at Supabase.

```bash
docker run -d --name pesapop-test-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres npm test
```

Every response in the tests is checked against `docs/openapi.yaml`, so contract drift fails CI.

## Layout

```
src/
  config/env.ts           validated environment (zod)
  routes/index.ts         every route, with its middleware
  controllers/            HTTP in/out only
  services/               business logic
    payment.service.ts    createDraft / confirm / getPayment   <- the only money-moving path is confirm()
    providers/types.ts    PaymentProvider + PaymentLinkProvider interfaces (Dev 2 plugs PayHero/Lipwa in here)
    providers/stub.ts     placeholder providers (never report success)
  middleware/             requireAuth, requireRole, validateBody/Query, errors, rate limits
  lib/serializers.ts      DB rows -> exact OpenAPI response shapes
  schemas.ts              request schemas (mirror the spec)
prisma/schema.prisma      User, Conversation, Message, PaymentDraft, Payment, PaymentRequest
```

## Safety rules enforced in code

- `POST /payments` and (later) the assistant only create a `PaymentDraft`. No provider is called.
- `confirm()` is the only caller of `PaymentProvider.initiate`. `Payment.draftId` is unique, so
  repeated or concurrent confirms return one payment and charge once (tested with 6 parallel taps).
- Only the draft's owner can confirm. Other users' drafts and payments return `404`.
  Expired drafts return `410 draft_expired`.
- Provider errors mark the payment `failed` with a reason. Nothing is ever faked as `success`.
- Errors are always `{ error: { code, message } }`. Logs never include request bodies, tokens or env values.
