# PesaPop

A Kenyan payment demo: type “send 500 to John”, review the summary, tap Confirm, and an
M-Pesa STK Push (via PayHero) asks the payer to approve on their phone. Money only moves
after an explicit Confirm tap, and success shows only when PayHero confirms it.

## What you need to do to make it work

The code is finished for the demo. What's left is accounts, keys and one PayHero check,
which only the team can do. Work through these in order; each level builds on the last.

### Level 1: run it on your laptop (no accounts needed, about 10 minutes)
You need **Node.js 20+**, **Git** and **Docker**. Then follow Runbook steps 1–2 below, ending with
`npm run dev`. Payments are **simulated** (no real M-Pesa, clearly labelled on every page).

### Level 2: put the demo online (still simulated, about 30 minutes)
| You need | Where to get it | Where it goes |
|----------|-----------------|---------------|
| A **Supabase** account and project | supabase.com → New project | Runbook step 4 (`npx supabase link`) |
| A **Vercel** account | vercel.com, sign in with GitHub | Runbook step 6 |
| Your **domain** (optional) | Your registrar | Vercel → Settings → Domains (step 6) |

Then do Runbook **step 4** (backend to Supabase) and **step 6** (frontend to Vercel).

### Level 3: turn on the AI assistant (optional, 5 minutes)
| You need | Where to get it | Where it goes |
|----------|-----------------|---------------|
| An **Anthropic API key** | console.anthropic.com → API keys | Supabase secret `ANTHROPIC_API_KEY` (step 4) |

Without it, a basic rule-based assistant runs and the page says so.

### Level 4: real M-Pesa payments with PayHero
| You need | Where to get it | Where it goes |
|----------|-----------------|---------------|
| A **PayHero** account with STK Push | payhero.co.ke | n/a |
| PayHero **API username and password** | PayHero dashboard → API keys | Supabase secrets `PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD` |
| PayHero **channel id** (your STK till/paybill channel) | PayHero dashboard → payment channels | Supabase secret `PAYHERO_CHANNEL_ID` |
| A random **callback token** | `openssl rand -hex 24` | Supabase secret `PAYHERO_CALLBACK_TOKEN` |

> **Required before real money:** the PayHero code (`supabase/functions/_shared/payhero.ts`) was
> written without access to PayHero's docs. A developer must compare its marked assumptions
> (A1–A6) with PayHero's official API docs and fix any differences first. Then follow Runbook
> **step 5**: test with **KES 1 to your own phone** in `sandbox` mode before considering `live`.

### Before you share the link
- Set `CORS_ORIGINS` to your domain and `.vercel.app` URL (step 4, then redeploy the function).
- Keep `MAX_AMOUNT` low (default KES 1,000). There are no accounts, so anyone with the link can use the demo.
- Want it private? Set `DEMO_ACCESS_CODE`, and the site will ask visitors for that passcode.
- Never put PayHero or Anthropic keys in Vercel or the frontend. They belong only in Supabase secrets.

## Architecture

```
 Web app (React + Vite)  ── hosted on Vercel, on your domain
        │  HTTPS  (X-Demo-Session: random id per browser, no accounts)
        ▼
 Supabase Edge Function "api"  ── the only backend
        ├─ Supabase Postgres   (tables locked: only the function can read/write them)
        ├─ PayHero STK Push    (send prompt; PayHero calls back /webhooks/payhero)
        └─ Claude              (payment assistant; optional)
 Secrets (PayHero, Anthropic) live only in Supabase secrets.
```

**Rules**
- The web app only calls the `api` function. It never calls Claude or PayHero.
- Only `POST /payments/{confirmation_id}/confirm` sends an STK push. It is idempotent: a draft can only ever create one payment, enforced by the database.
- Never fake success. `PROVIDER_MODE=simulated` moves no money and every page says so.
- No sign-up in this MVP. Each browser gets a random id; customers see only their own payments. The Merchant view shows all demo payments for one demo shop, with other people's phone numbers masked.
- Abuse guards (no accounts means anyone with the link can use it): amount cap (default KES 1,000), rate limit (default 5 payments per 10 min per browser and per IP), optional shared passcode.

## Repo layout

| Path | What it is |
|------|------------|
| `docs/openapi.yaml` | The API contract (source of truth) |
| `supabase/migrations/` | Database schema |
| `supabase/functions/api/index.ts` | Edge Function entry point |
| `supabase/functions/_shared/` | All backend logic (runs on Deno in Supabase and on Node locally) |
| `supabase/functions/_shared/payhero.ts` | PayHero adapter (**must be verified against PayHero's docs, see Step 5**) |
| `dev/` | Local dev server and migration runner (Node) |
| `tests/` | Backend tests (real Postgres, every response checked against the contract) |
| `web/` | The React frontend (deployed to Vercel) |

## Status

| Area | State |
|------|-------|
| Backend: drafts, idempotent confirm, history, merchant view, assistant, PayHero callback, abuse guards | Done, 29 tests |
| Frontend: landing, customer home, pay, assistant, status, history, merchant dashboard and requests | Done, 19 tests |
| Simulated payments | Done |
| PayHero sandbox/live | Code written, **not yet verified** against PayHero's docs (Step 5) |
| Supabase and Vercel deploy | Steps below |

---

# Runbook (one person)

## 1. One-time setup
Install Node.js 20+, Git and Docker. Then:
```bash
git clone https://github.com/cliff13255/PesaPop && cd PesaPop
git checkout erick
npm install            # backend tooling
cd web && npm install && cd ..
```

## 2. Run everything locally
```bash
# Local Postgres (once; afterwards just: docker start pesapop-db)
docker run -d --name pesapop-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
docker exec pesapop-db createdb -U postgres pesapop
docker exec pesapop-db createdb -U postgres pesapop_test

cp .env.example .env   # defaults are fine: simulated payments, no passcode
npm run db:local       # create the tables
npm run dev            # starts BOTH the API (http://localhost:8787/api) and the web app
```
`npm run dev` is the one command to remember. If the web page says it **cannot reach the
PesaPop API**, the API isn't running: start it with `npm run dev` (or `npm run dev:api` on its
own) in the repo root. To run them separately: `npm run dev:api` in the repo root, and
`npm run dev` inside `web/`.

If `docker run ... postgres:17` can't download the image, any Postgres 15+ works; Supabase's
image (`public.ecr.aws/supabase/postgres:17.6.1.147`) is the closest match to production.
Open http://localhost:5173 (Vite picks 5174 if 5173 is busy) and tap **Try the demo**. Payments are simulated: they turn
successful about 10 seconds after Confirm, and the number `+254700000000` always fails so
you can show the failure screen.

## 3. Run the tests
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop_test npm test   # backend: 29 tests
cd web && npm test                                                                       # frontend: 19 tests
```
The backend tests wipe `TEST_DATABASE_URL`. Never point it at Supabase.

## 4. Deploy the backend to Supabase
1. Create a project at supabase.com. Note the **project ref** (from the URL `https://<ref>.supabase.co`).
2. From the repo root:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push                                   # creates the tables
   npx supabase secrets set PROVIDER_MODE=simulated MAX_AMOUNT=1000 RATE_LIMIT_COUNT=5 RATE_LIMIT_WINDOW_MINUTES=10 SHOP_NAME="PesaPop Demo Shop" IP_HASH_SALT=$(openssl rand -hex 16)
   npx supabase functions deploy api --no-verify-jwt
   ```
3. Check: `https://<ref>.supabase.co/functions/v1/api/health` returns `{"status":"ok"}`.

Optional secrets:
- `ANTHROPIC_API_KEY=...` turns on the Claude assistant (otherwise a basic rule-based assistant runs, labelled in the UI). `ASSISTANT_MODEL` defaults to `claude-opus-5-5`.
- `DEMO_ACCESS_CODE=...` makes the site ask for a shared passcode.
- `CORS_ORIGINS=https://your-domain.co.ke,https://your-app.vercel.app` (default `*`). Set it once the domain is live.

After changing secrets, redeploy: `npx supabase functions deploy api --no-verify-jwt`.

## 5. Switch on real M-Pesa (PayHero)
`supabase/functions/_shared/payhero.ts` was written **without access to PayHero's docs**
(their site blocked automated reading). Before going past simulated mode:
1. Open PayHero's API docs and check assumptions A1–A6 at the top of `payhero.ts`: endpoint, auth header, request fields, response field, callback body, and whether callbacks are signed. Fix anything that differs, and update `parsePayHeroCallback` plus the tests in `tests/api.test.ts`.
2. In the PayHero dashboard get your API username and password and your STK channel id.
3. Set the secrets and redeploy:
   ```bash
   npx supabase secrets set PROVIDER_MODE=sandbox \
     PAYHERO_API_USERNAME=... PAYHERO_API_PASSWORD=... PAYHERO_CHANNEL_ID=... \
     PAYHERO_CALLBACK_URL=https://<ref>.supabase.co/functions/v1/api/webhooks/payhero \
     PAYHERO_CALLBACK_TOKEN=$(openssl rand -hex 24)
   npx supabase functions deploy api --no-verify-jwt
   ```
4. Make a KES 1 payment to your own phone. Watch it go pending, then success after you enter your PIN.
5. Only then consider `PROVIDER_MODE=live`.

## 6. Deploy the frontend to Vercel and connect your domain
1. In Vercel: **Add New → Project →** import `cliff13255/PesaPop`, branch `erick`.
2. Set **Root Directory** to `web`. Framework: Vite (detected from `web/vercel.json`).
3. Environment variable: `VITE_API_URL=https://<ref>.supabase.co/functions/v1/api`.
4. Deploy, then open the `.vercel.app` URL and run through the demo.
5. **Settings → Domains →** add your domain and create the DNS records Vercel shows at your registrar.
6. Set `CORS_ORIGINS` in Supabase to your domain plus the `.vercel.app` URL (Step 4), then redeploy the function.

## Demo script (about 3 minutes)
1. Landing page: one sentence on the problem, tap **Try the demo**.
2. Open **Assistant**, type `send 500 to John`. Show the **Still needed** card.
3. Answer `0712 345 678`. Show the summary card: “Nothing has been paid yet.”
4. Tap **Review and confirm**, then **Confirm**. Show pending, then success with the receipt.
5. Switch to **Merchant**: the totals updated. Tap **Request payment** to send an STK push to a customer.
6. Close on safety: the AI never moves money; only an explicit Confirm does, and success only shows when M-Pesa confirms.

Practise twice on a phone and keep a screen recording as a backup.
