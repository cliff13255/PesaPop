# PesaPop mock API

An Express stub that matches [`../docs/openapi.yaml`](../docs/openapi.yaml) exactly, so the
Bubble team can build before the real backend exists. **Everything here is demo data.**
State lives in memory and resets on restart. No money moves and nothing calls Claude or PayHero.

```bash
cd mock
npm install
npm start        # http://localhost:4000  (PORT env var overrides)
npm test         # validates every response against the OpenAPI spec
```

## Demo accounts and tokens

| Role     | Email                   | Password      | Static token (for API Connector init) |
|----------|-------------------------|---------------|---------------------------------------|
| customer | `customer@pesapop.test` | `password123` | `demo-customer-token`                 |
| merchant | `merchant@pesapop.test` | `password123` | `demo-merchant-token`                 |

Any bearer token is accepted. Tokens returned by `/auth/login` or `/auth/register` map to that
user; the two static tokens map to the demo accounts; any other token is treated as the demo
customer. Role checks are real: a customer token gets `403` on merchant endpoints.

## Behaviour worth knowing

- `POST /payments` only creates a draft (expires after 10 minutes). Nothing is "paid".
- `POST /payments/{confirmation_id}/confirm` returns `pending`. Confirming the same id again
  returns the same payment (idempotent). Another user's draft returns `404`; an expired one `410`.
- `GET /payments/{id}` returns `pending` for 10 seconds after confirm, then `success` with a receipt.
- **Failure path:** use phone `+254700000000` and the payment turns `failed` after 10 seconds.
- Seeded `pending` rows in history stay pending forever (they are sample data).
- `POST /assistant/messages` is a rule-based stand-in for Claude. It understands things like
  `send 500 to John`, `pay 1k to Mary 0722000333`, `pay my electricity bill`, `cancel that`.
  It returns `missing_fields` until amount, recipient and phone are known, then returns a
  `payment_summary` and `confirmation_id`. It never confirms anything.
- Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

## Deploy

`render.yaml` at the repo root deploys this folder to Render (free plan, `/health` check).
On Railway, set the root directory to `mock` and the start command to `npm start`.
