# PesaPop

A Kenyan payment app where people pay in plain language ("send 500 to John") and confirm
every payment before money moves. Supports M-Pesa STK Push (via PayHero) and Lipwa links.

## Architecture

```
 Bubble app (frontend only)
        |  HTTPS + Bearer token
        v
 PesaPop API  (/api, Node.js + Express + TypeScript)
        |-- Supabase Postgres (via Prisma)
        |-- Anthropic Claude   (payment assistant)
        |-- PayHero            (M-Pesa STK Push, callbacks)
        '-- Lipwa              (payment links)
```

**Bubble never calls Claude, PayHero or Lipwa.** It only calls the PesaPop API. All secrets
(Anthropic key, PayHero credentials, Supabase keys) live in `api/.env` and nowhere else.

## Repo layout

| Path                   | What it is                                                            |
|------------------------|-----------------------------------------------------------------------|
| `docs/openapi.yaml`    | The API contract. **Source of truth.** Change a field only after telling the whole team. |
| `docs/BUBBLE_SETUP.md` | How the Bubble app is wired to the API                                |
| `mock/`                | Stub server that matches the contract, for building Bubble early ([README](mock/README.md)) |
| `api/`                 | The real backend: auth, drafts, confirm, history ([README](api/README.md)) |

## Rules

- Amounts are integers in KES. Phones are E.164 (`+2547...` / `+2541...`). Statuses are exactly
  `pending`, `success`, `failed`.
- Money moves **only** on `POST /payments/{confirmation_id}/confirm`, after an explicit user tap.
  Confirm is idempotent. The AI assistant can create drafts but can never confirm.
- Never fake success. Show `success` only when the API says so. Anything not wired yet shows a
  clear "demo data" label.

## Status

| Phase | What | State |
|-------|------|-------|
| 0 | API contract (`docs/openapi.yaml`), mock server | Done |
| 1-2 | Backend auth, payment drafts, idempotent confirm, history, merchant summary, payment requests (51 tests) | Done |
| 3 | Claude assistant, PayHero, Lipwa | Runbook steps 4-5 |
| 1-4 (Bubble) | Design system, API Connector, all pages | Runbook steps 6-12 |
| 5-6 | Switch to real API, polish, deploy, demo | Runbook steps 13-15 |

Until step 5 is done, the real API uses a placeholder payment provider: confirmed payments stay
`pending` forever and payment links are `null`. That is intended, so nothing fakes a success.

---

# Runbook (one person)

Follow this top to bottom. Every command and prompt is ready to copy.

## Part 1: One-time setup

**Install:** Node.js 20 or newer, Git, Docker Desktop, and Claude Code
(`npm install -g @anthropic-ai/claude-code`).

**Get the code:**
```bash
git clone https://github.com/cliff13255/PesaPop
cd PesaPop
git checkout erick
```
`erick` holds all the work so far. Stay on it, and commit and push after every step (Part 4).

---

## Part 2: Run the project locally

### A. The mock API (fake backend for building Bubble)
```bash
cd mock
npm install
npm test          # should print: pass 9, fail 0
npm start         # http://localhost:4000
```
Check it in another terminal: `curl http://localhost:4000/health` should print `{"status":"ok"}`.

The mock has demo logins `customer@pesapop.test` and `merchant@pesapop.test`, both with password
`password123`. Payments to `+254700000000` always fail, so you can test the failure screen.
More details in [mock/README.md](mock/README.md).

### B. The real API
**1. Start a local Postgres in Docker** (one time):
```bash
docker run -d --name pesapop-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
docker exec pesapop-db createdb -U postgres pesapop
docker exec pesapop-db createdb -U postgres pesapop_test
```
After a restart, bring it back with `docker start pesapop-db`.

**2. Configure:**
```bash
cd api
npm install
cp .env.example .env
openssl rand -base64 48      # copy the output
```
Open `api/.env` and set these three values (leave the rest empty for now):
```
JWT_SECRET=<the output you copied>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop
```

**3. Create the tables, add the demo users, and run it:**
```bash
npm run db:deploy
npm run db:seed
npm run dev                  # http://localhost:3000
```

**4. Run the tests.** They use the separate `pesapop_test` database because they wipe every table:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop_test npm test
```
You should see `51 passed`. More details in [api/README.md](api/README.md).

---

## Part 3: Put the mock online (needed for Bubble)

1. Create a free account at render.com and connect GitHub.
2. Choose **New → Blueprint**, pick this repo and the `erick` branch. Render reads `render.yaml`
   and deploys `pesapop-mock`.
3. Copy the URL, for example `https://pesapop-mock.onrender.com`. This is your **MOCK_URL**.

Free Render services sleep when idle, so the first request after a break takes about 30 seconds.

---

## Part 4: How to run each prompt

For each step in Part 5:
1. Open a terminal in the folder named in the step and run `claude`.
2. Paste the prompt.
3. Read what it changed before accepting.
4. Run the tests: `npm test` in `mock`, or the test command from Part 2 in `api`.
5. Commit and push:
   ```bash
   git add -A && git commit -m "Step N: <what>" && git push
   ```

For the Bubble steps (6 to 14), connect Bubble to Claude Code once:
```bash
claude mcp add --transport http --scope user bubble https://mcp.bubble.io/mcp
```
Then inside `claude`, type `/mcp` and sign in to Bubble. Always work on the Bubble
**development** version.

---

## Part 5: The prompts, in order

### Step 1: Test checklist (repo root)
```
Read README.md, docs/openapi.yaml, mock/README.md and api/README.md. Write docs/TEST_CHECKLIST.md: a manual checklist for testing PesaPop against both the mock and the real API. Cover: registering as each role, duplicate email or phone (409), wrong password (401), protected pages without a token, an expired draft (410), double-tapping Confirm (same payment id, one charge), a failed payment (on the mock, phone +254700000000), a customer opening merchant pages (403), pagination and status filters, and the assistant's "Still needed" flow. For each case give the steps, the expected result and a pass/fail column. Add 10 messy assistant prompts ("send 500 bob", "pay 1k to 0712...", "cancel that", Sheng mixes, amounts with commas, missing recipient, asking for a PIN) with the expected behaviour: ask, never guess.
```

### Step 2: Deploy setup and CI (`api`)
```
Read README.md, api/README.md and docs/openapi.yaml. Phases 1-2 of the backend are built and tested; do not change response shapes without updating docs/openapi.yaml.
1. Add a Dockerfile for /api (multi-stage, node 20 or later; on start runs `npx prisma migrate deploy` then `node dist/server.js`) and add an /api web service to the root render.yaml next to the mock, with every secret as an env var with sync: false.
2. Add a request log middleware: method, path, status, duration. Never log bodies, Authorization headers or tokens; mask phone numbers like +2547******78.
3. Add GitHub Actions CI on push and PR: a postgres:17 service, TEST_DATABASE_URL set, then npm ci, typecheck, build and test in /api, and npm test in /mock.
4. Update api/README.md with deploy steps, including where to find Supabase's pooled (port 6543, ?pgbouncer=true&connection_limit=1) and direct (port 5432) connection strings.
Finish by listing the exact env vars I must set in Render.
```

### Step 3: Supabase and deploying the API (manual)
1. Create a project at supabase.com. In **Project Settings → Database → Connection string**, copy
   the **Transaction pooler** string (port 6543) and the **Session/direct** string (port 5432).
2. In Render, open the new `pesapop-api` service and set the env vars from Step 2:
   - `DATABASE_URL` = the pooler string, ending in `?pgbouncer=true&connection_limit=1`
   - `DIRECT_URL` = the direct string
   - `JWT_SECRET` = a new `openssl rand -base64 48`
   - `CORS_ORIGINS` = your Bubble app URLs
3. Deploy. Then seed the demo users once from your laptop:
   ```bash
   cd api
   DATABASE_URL="<pooler string>" DIRECT_URL="<direct string>" npm run db:seed
   ```
4. Check `https://<api-url>/health`. That URL is your **API_URL**.

### Step 4: The Claude assistant (`api`)
First get an API key at console.anthropic.com. Put it in `api/.env` as `ANTHROPIC_API_KEY=...`
and in Render's env vars. Never put it in Bubble.
```
Read api/README.md, docs/openapi.yaml (POST /assistant/messages), api/src/services/payment.service.ts (createDraft), api/src/schemas.ts (createPaymentBody), api/prisma/schema.prisma (Conversation, Message), api/src/middleware/rateLimit.ts (assistantLimiter) and api/test/helpers.ts.

Implement POST /assistant/messages with the official Anthropic TypeScript SDK and the latest Claude model. ANTHROPIC_API_KEY comes only from env; if it is missing, return 502 assistant_unavailable.
- requireAuth + assistantLimiter. Body: message, optional conversation_id; another user's conversation returns 404.
- Save user and assistant messages; send the last 20 as history.
- System prompt: PesaPop's payment assistant for Kenya. Extract method (mpesa_stk|payhero|lipwa, default mpesa_stk), amount in whole KES ("1k" = 1000, "bob" = KES), recipient, phone (normalise 07.../01.../254... to +254...), and an optional reference. Ask for anything missing; never guess a phone number or amount; never claim a payment was made; never ask for a PIN or password; "cancel" clears the intent.
- Use tool calling for structured output, validated with zod against createPaymentBody. When complete, call createDraft and return payment_summary + confirmation_id. Otherwise return missing_fields (only method|amount|recipient|phone|reference) with payment_summary and confirmation_id set to null. The assistant must NEVER call confirm.
- Inject the Anthropic client through createApp options so tests can fake it. Timeouts and API errors return 502 assistant_unavailable.
- Tests with a fake client: missing fields, a full intent that creates a draft but no Payment, cancel, a foreign conversation_id, the client throwing, and invalid tool output. Use expectContract on every response.
```

### Step 5: PayHero and Lipwa (`api`)
First get PayHero and Lipwa sandbox credentials and fill the `PAYHERO_*` values in `api/.env`
and in Render.
```
Read api/src/services/providers/types.ts, providers/stub.ts, payment.service.ts and paymentRequest.service.ts. Implement real providers behind those interfaces. Do NOT change confirm(); it is the only caller of initiate().
- PayHero (methods mpesa_stk and payhero): initiate() sends an STK push using PAYHERO_* env vars and returns pending + providerReference, or failed + a reason. PROVIDER_MODE=sandbox|live picks the base URL.
- POST /webhooks/payhero (no requireAuth): verify the callback using PAYHERO_CALLBACK_SECRET as PayHero documents it. Find the Payment by providerReference and update it EXACTLY ONCE with updateMany where status = 'pending': success (store mpesaReceipt, paidAt) or failed (store failureReason). Return 200 once verified and 401 if not. If the payment belongs to a PaymentRequest, update that too.
- Lipwa: implement PaymentLinkProvider.createLink. Wire both into app.ts in place of stubProviders.
- Log one line per provider call (payment id, method, amount, mode). Never log secrets or full phone numbers.
- Add the webhook to docs/openapi.yaml.
- Tests with mocked fetch: success, failure, timeout, a webhook replay that must not update twice, and a bad signature returning 401.
Use only the official PayHero and Lipwa docs. If anything is unclear (auth scheme, signature, field names), STOP and list exactly what you need instead of guessing.
```
Then set the PayHero callback URL in their dashboard to `https://<API_URL>/webhooks/payhero`.

### Step 6: Bubble design system (Bubble MCP)
```
Using Bubble MCP in the PesaPop app (development branch only), set up the design system before any pages:
- Colours: navy #0B1F3A (primary), green #12B76A (accent/success), white, light grey background, amber (pending), red (failed)
- Font: Inter; heading and body styles
- Reusable elements: Navbar (logged-out and logged-in), Buttons (primary, secondary, danger), StatusBadge (pending/success/failed with colour and icon), Card, TransactionRow, EmptyState, LoadingSpinner, ErrorBanner, and a "Demo data" pill
- Mobile first, container max width 1100px
Create a hidden style-guide page showing every element. Do not create any API calls.
```

### Step 7: API Connector (Bubble MCP)
```
Read docs/openapi.yaml and docs/BUBBLE_SETUP.md. Using Bubble MCP in the PesaPop app (development branch), create API Connector groups Auth, Assistant, Payments, Transactions and Merchant, with calls register, login, me, assistant_message, create_payment, confirm_payment, get_payment, create_payment_request, list_payment_requests, list_transactions and merchant_summary. Every call uses ONE shared base_url (initial value <MOCK_URL>). Protected calls send a private "Authorization: Bearer <token>" header. Match the spec exactly:
- lists return { items, pagination: { page, limit, total, total_pages } }
- payment_summary has method, amount, fee, total, currency, phone, recipient, reference, expires_at
- assistant_message always returns payment_summary and confirmation_id (null until a draft exists)
- login uses email + password
- create_payment requires recipient; reference is optional
- errors are { error: { code, message } }
Mark each call Data or Action. Then give me a step-by-step list of what I must initialize by hand in the editor, with test values: token demo-customer-token (demo-merchant-token for merchant calls), the assistant message "pay 1k to Mary 0722000333", and for get_payment an id from confirm_payment after waiting 10 seconds. Update docs/BUBBLE_SETUP.md.
```
Then open the Bubble editor and initialize each call by hand as listed. Bubble MCP can't do that step.

### Step 8: Auth page (Bubble MCP)
```
Using Bubble MCP (development branch), build the auth page with Login and Register tabs. Fields: name, phone (+2547...), email, password, role (Customer/Merchant). Call the Auth API calls, store the returned token and role on the current user or in a custom state, and redirect to customer-dashboard or merchant-dashboard by role. Show ErrorBanner with error.message from the API, and a loading state while waiting. On every protected page, add a page-load check that redirects to auth when there is no token. Never show or log the token.
```

### Step 9: Pay page (Bubble MCP)
```
Using Bubble MCP, build the pay page. Method selector: M-Pesa STK Push (mpesa_stk), PayHero (payhero), Lipwa (lipwa). Fields: amount (whole KES), phone (+2547...), recipient (required) and reference (optional), with client-side format checks. Review calls create_payment and opens a Confirmation popup showing payment_summary: recipient, amount, fee, total, method, phone, reference. Buttons: Cancel and Confirm. ONLY Confirm calls confirm_payment with confirmation_id, and it is disabled after the first tap. Then show a status screen that polls get_payment every 3 seconds and shows StatusBadge: pending, then success or failed (with failure_reason). Never show success until the API says success. Show error.message on 410 (expired: "start again") and on other errors. On the mock, phone +254700000000 fails, so test the failed state with it.
```

### Step 10: Assistant page (Bubble MCP)
```
Using Bubble MCP, build the assistant page: chat bubbles (user right, assistant left), an input bar with Send, a typing indicator during the API call, and quick-prompt chips ("Pay my electricity bill", "Send KES 500 to John"). Send each message with assistant_message, keeping conversation_id in a custom state, and append the reply. If missing_fields is not empty, show a highlighted "Still needed" card listing them. If payment_summary is not empty, show a PaymentSummary card with a Review and Confirm button that opens the SAME Confirmation popup as the pay page; only that popup's Confirm calls confirm_payment. Show errors with a Retry button.
```

### Step 11: Dashboards and history (Bubble MCP)
```
Using Bubble MCP and the existing design system, build:
1. customer-dashboard: a welcome header with the name from me; quick-action cards (Pay with M-Pesa, Ask the AI assistant, Pay a Lipwa link) linking to the pay and assistant pages; Recent Transactions (latest 5 from list_transactions with limit=5) using TransactionRow + StatusBadge; a View all link to history. Include loading skeletons, EmptyState and ErrorBanner with retry. Cards stack on mobile.
2. merchant-dashboard: four cards from merchant_summary (total_received, then success, pending and failed with count and KES total, colour-coded). A "Request payment" button opens a form (amount, customer_phone, description) that calls create_payment_request, then shows the link with a Copy button (if link is null, say "Link not available yet"). Add a payment requests table (list_payment_requests) and a transactions preview. Redirect non-merchants to customer-dashboard.
3. history: a table (cards on mobile) with reference, amount KES, method, date in Africa/Nairobi time, and StatusBadge; tabs All/Success/Pending/Failed mapped to the status param; pagination using page, limit and pagination.total_pages; EmptyState. Clicking a row opens a detail popup from get_payment showing the receipt.
Show the "Demo data" pill on every page while base_url points at the mock.
```

### Step 12: Landing page (Bubble MCP)
```
Using Bubble MCP, build the index landing page: a hero with a headline about paying in Kenya with plain-language requests, a subheading about M-Pesa, PayHero and Lipwa, and Login and Get Started buttons (both to auth). Below: three benefit cards (talk to pay, confirm before you pay, clear status tracking), a three-step how-it-works section, a trust section (you confirm every payment; we never ask for your PIN), and a footer. Navy and white with green accents, fully responsive. Do not invent customer numbers or testimonials.
```

### Step 13: Switch Bubble to the real API (Bubble MCP)
```
Using Bubble MCP, change the shared base_url from <MOCK_URL> to <API_URL>, in one place only. Re-check every call's response shape against the real API and list any mismatches. Do not change the backend. Remove the "Demo data" pills only where data now comes from the real API.
```
If it reports mismatches, fix the API in `/api` (and update `docs/openapi.yaml`), or adjust the
Bubble mapping.

### Step 14: Polish and security review
In Bubble MCP:
```
Using Bubble MCP, audit every page for: loading, empty and error states; layout at 375px wide; consistent spacing, colours and buttons from the design system; a working navbar and a logout that clears the token; readable contrast on navy and green; and friendly error text instead of raw API responses. Fix what you can and list what needs fixing by hand in the editor.
```
In `api`:
```
Review /api for these risks and fix them: any route that moves money without the confirm step; any endpoint missing requireAuth; any place a secret (Anthropic key, PayHero credentials, Supabase keys or the database password) could be logged or returned; any missing ownership check on payments, drafts or conversations; and the webhook accepting unverified callbacks. Run the tests and report.
```

### Step 15: End-to-end test and Bubble deploy (manual)
1. On your phone, with sandbox credentials, go through `docs/TEST_CHECKLIST.md`: register, ask
   the assistant to pay, review, confirm, watch pending turn into success, and check history as
   both roles.
2. Fix anything that fails, then push.
3. Deploy Bubble from the editor (**Deploy to live**). Bubble MCP can't deploy.

---

## If time runs short

Protect this flow above everything: **type a request → review the summary → Confirm → watch the
status change.** Cut in this order: landing extras, then Lipwa and payment requests, then history
filters, then popups and pagination. Never cut the draft → confirm → status flow or the "never
fake success" rule.

### Demo script (about 3 minutes)
1. Landing page: one sentence on the problem, then tap Get Started.
2. Log in as a customer and show the dashboard.
3. Open the assistant and type "send 500 to John". Show the "Still needed" card.
4. Give the phone number, review the summary, tap Confirm.
5. Show pending, then success, then the new row in history.
6. Switch to the merchant account: summary cards and a payment request with its Lipwa link.
7. Close on safety: the AI never moves money; only an explicit Confirm does.

Practise twice on a phone, and keep a screen recording as a backup in case the payment sandbox is down.
