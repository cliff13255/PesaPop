# PesaPop

PesaPop is a demo payment app for Kenya. You type something like **"send 500 to John"**, the app
shows you a summary, you tap **Confirm**, and M-Pesa sends a payment prompt to the phone. Money
only moves after you tap Confirm, and the app only says "successful" when M-Pesa confirms it.

> **New here? Read this page from top to bottom and do the steps in order.**
> Each part tells you **what you need**, **where to get it**, **where to put it**, and
> **what you should see** when it works. Parts A–C are enough to show a working demo.

| Part | What you get | Time | Accounts needed |
|------|--------------|------|-----------------|
| [A. Run it on your computer](#part-a-run-it-on-your-computer) | The demo on your own laptop | ~20 min | None |
| [B. Put the backend online (Supabase)](#part-b-put-the-backend-online-supabase) | The "brain" of the app on the internet | ~20 min | Supabase |
| [C. Put the website online (Vercel)](#part-c-put-the-website-online-vercel) | A public link, optionally your own domain | ~15 min | Vercel |
| [D. Turn on the AI assistant](#part-d-turn-on-the-ai-assistant-optional) (optional) | Smarter chat | ~5 min | Anthropic |
| [E. Real M-Pesa payments (PayHero)](#part-e-real-m-pesa-payments-payhero) | Real prompts on real phones | needs a developer | PayHero |

Until Part E is done, payments are **simulated**: no real M-Pesa prompt is sent, no money moves,
and a yellow banner on every page says so. That is safe for demos.

---

## Before you start: what to install and which accounts to create

### Install these on your computer (all free)
| Program | Why you need it | Where to get it | How to check it worked |
|---------|-----------------|-----------------|------------------------|
| **Node.js** (version 20 or newer, "LTS") | Runs the app | https://nodejs.org | Open a terminal and type `node -v`. You should see `v20...` or higher |
| **Git** | Downloads the code | https://git-scm.com/downloads | `git --version` |
| **Docker Desktop** | Runs a database on your laptop | https://www.docker.com/products/docker-desktop | Open Docker Desktop and wait until it says it is running, then type `docker ps` |
| A code editor (optional) | To look at or edit files | https://code.visualstudio.com | n/a |

**What is a terminal?** It's the window where you type commands.
- **Windows:** press Start, type **PowerShell**, open it.
- **Mac:** press Cmd+Space, type **Terminal**, open it.
- **Linux:** open **Terminal** from your apps.

Type each command, press Enter, and wait for it to finish before typing the next one.

### Create these accounts (only when you reach that part)
| Account | Needed for | Website | Cost |
|---------|------------|---------|------|
| **GitHub** | Getting the code, and connecting Vercel | https://github.com | Free |
| **Supabase** | Part B (backend and database) | https://supabase.com | Free plan is enough |
| **Vercel** | Part C (website hosting and your domain) | https://vercel.com (sign up **with GitHub**) | Free plan is enough |
| **Anthropic** | Part D (AI assistant, optional) | https://console.anthropic.com | Pay as you go |
| **PayHero** | Part E (real M-Pesa) | https://payhero.co.ke | See PayHero pricing |

### Things you will copy and paste along the way
Keep a private note (not in the code, not in chat groups) with these values as you collect them:

| Value | Example | You get it in |
|-------|---------|---------------|
| Supabase **project ref** | `abcdwxyzabcdwxyzabcd` | Part B, step 1 |
| Supabase **database password** | (you choose it) | Part B, step 1 |
| Your **API URL** | `https://abcdwxyzabcdwxyzabcd.supabase.co/functions/v1/api` | Part B, step 6 |
| Your **website URL** | `https://pesapop-xyz.vercel.app` | Part C, step 5 |
| Anthropic **API key** (optional) | `sk-ant-...` | Part D |
| PayHero **API username, password, channel id** | from PayHero | Part E |

> **Keep keys secret.** API keys and passwords go only into **Supabase secrets** (Part B). Never
> put them in the website (Vercel), in GitHub, or in screenshots.

---

## Part A: Run it on your computer

**You need:** Node.js, Git and Docker Desktop installed (see above). **No accounts.**

**1. Download the code.** In your terminal:
```bash
git clone https://github.com/cliff13255/PesaPop
cd PesaPop
git checkout erick
```
You should now be "inside" the `PesaPop` folder. Every command below is typed from this folder
unless it says otherwise.

**2. Install the app's building blocks** (takes a minute or two):
```bash
npm install
cd web
npm install
cd ..
```

**3. Start a database on your laptop.** First open **Docker Desktop** and wait until it's running. Then:
```bash
docker run -d --name pesapop-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
docker exec pesapop-db createdb -U postgres pesapop
docker exec pesapop-db createdb -U postgres pesapop_test
```
You only do this once. After restarting your computer, open Docker Desktop and run
`docker start pesapop-db`.

**4. Create your settings file and the database tables:**
```bash
cp .env.example .env
npm run db:local
```
You should see `applied 20261121120000_init.sql`. The default settings are fine: simulated
payments, no passcode.

**5. Start the app:**
```bash
npm run dev
```
Leave this terminal open; the app runs while it's open. Lines starting with `[api]` and `[web]`
will appear. Press **Ctrl+C** to stop.

**6. Open the app.** In your browser go to **http://localhost:5173** (if that's busy, the terminal
shows another address, such as 5174). Tap **Try the demo**.

**What you should see:** the PesaPop home page with a yellow "Demo mode: payments are simulated"
banner. Try the assistant: type `send 500 to John`, then `0712 345 678`, then tap **Review and
confirm** and **Confirm**. After about 10 seconds it shows **Payment successful**. The phone number
`+254700000000` always fails, so you can show what a failed payment looks like.

✅ **Part A done.** If something went wrong, see [Troubleshooting](#troubleshooting).

---

## Part B: Put the backend online (Supabase)

**You need:** a **Supabase** account, and Part A working (Docker Desktop open).
**What this does:** puts the app's backend (the part that stores payments and talks to M-Pesa)
on the internet, so the website can use it from anywhere.

**1. Create a Supabase project.**
1. Go to https://supabase.com and sign in. Click **New project**.
2. Name it `pesapop`. Choose a strong **Database password**, and **save it in your private note**. Choose the region closest to Kenya.
3. Wait until the project finishes setting up.
4. Find your **project ref**: open **Project Settings → General** and copy the **Project ID**
   (a string of about 20 letters). It's also the part of your project's URL before `.supabase.co`.
   **Save it in your note.**

**2. Log in to Supabase from your terminal** (from the `PesaPop` folder):
```bash
npx supabase login
```
A browser window opens. Approve it, then come back to the terminal.

**3. Connect this folder to your project.** Replace `YOUR_PROJECT_REF` with the value from step 1:
```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```
If it asks for the database password, paste the one you saved.

**4. Create the database tables online:**
```bash
npx supabase db push
```
Answer `Y` if it asks to apply the migration.

**5. Add the app's settings (called "secrets").** First generate a random value:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```
Copy what it prints, then run this, replacing `PASTE_RANDOM_VALUE`:
```bash
npx supabase secrets set PROVIDER_MODE=simulated MAX_AMOUNT=1000 RATE_LIMIT_COUNT=5 RATE_LIMIT_WINDOW_MINUTES=10 IP_HASH_SALT=PASTE_RANDOM_VALUE
```
You can also view and edit secrets in the Supabase website under **Edge Functions → Secrets**.

| Secret | What it means | Default |
|--------|---------------|---------|
| `PROVIDER_MODE` | `simulated` = fake payments, `sandbox` = PayHero test, `live` = real money | `simulated` |
| `MAX_AMOUNT` | Highest KES amount allowed per payment | `1000` |
| `RATE_LIMIT_COUNT` / `RATE_LIMIT_WINDOW_MINUTES` | Max payments per visitor in that many minutes | `5` / `10` |
| `SHOP_NAME` | Name shown in the Merchant view | `PesaPop Demo Shop` |
| `DEMO_ACCESS_CODE` | If set, visitors must type this passcode | empty (no passcode) |
| `CORS_ORIGINS` | Which websites may use the backend (set in Part C) | `*` (any) |

**6. Upload the backend:**
```bash
npx supabase functions deploy api --no-verify-jwt
```
Your **API URL** is:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/api`. **Save it in your note.**

**What you should see:** open `https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health` in
your browser. It shows `{"status":"ok"}`.

> Whenever you change a secret, run the deploy command in step 6 again so the change takes effect.

✅ **Part B done.**

---

## Part C: Put the website online (Vercel)

**You need:** a **Vercel** account (sign up with GitHub), and your **API URL** from Part B.
Your GitHub account must be able to see the `cliff13255/PesaPop` repository; ask the owner to
add you if you can't.

**1.** Go to https://vercel.com and click **Add New… → Project**.

**2.** Find **PesaPop** in the list and click **Import**. (If it isn't listed, click **Adjust GitHub
App Permissions** and allow access to the repository.)

**3.** On the setup screen:
- **Root Directory:** click **Edit** and choose **`web`**. This step is important.
- **Framework Preset:** **Vite** (usually chosen automatically).
- Open **Environment Variables** and add:
  - **Name:** `VITE_API_URL`
  - **Value:** your API URL, e.g. `https://abcdwxyzabcdwxyzabcd.supabase.co/functions/v1/api`

**4.** Click **Deploy** and wait for it to finish.

**5.** Click the preview to open your site. The address looks like `https://pesapop-xyz.vercel.app`.
**Save it in your note.** Tap **Try the demo** and make a test payment.

**6. Connect your own domain (optional).**
1. In your Vercel project go to **Settings → Domains**, type your domain (e.g. `pesapop.co.ke`) and click **Add**.
2. Vercel shows one or two **DNS records** (usually an `A` record and/or a `CNAME`).
3. Log in where you bought the domain (your registrar), open its **DNS settings**, and add exactly those records.
4. Wait. It can take from a few minutes to a few hours. Vercel shows **Valid Configuration** when it works.

**7. Lock the backend to your website** (recommended). Replace the addresses with yours:
```bash
npx supabase secrets set CORS_ORIGINS=https://pesapop.co.ke,https://pesapop-xyz.vercel.app
npx supabase functions deploy api --no-verify-jwt
```

> If you change `VITE_API_URL` later, go to Vercel → **Deployments**, open the menu (⋯) on the
> latest one, and click **Redeploy**. Vercel only reads it when building.

✅ **Part C done: you have a public demo link.**

---

## Part D: Turn on the AI assistant (optional)

**You need:** an **Anthropic** account with billing set up.
Without this, a basic assistant still works for simple requests like "send 500 to John", and the
page says "Basic mode".

1. Go to https://console.anthropic.com → **API Keys** → **Create Key**. Copy it (starts with `sk-ant-`).
2. Add it to Supabase and redeploy:
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-PASTE_YOUR_KEY
   npx supabase functions deploy api --no-verify-jwt
   ```
3. **What you should see:** the "Basic mode" note disappears from the Assistant page, and it understands messy requests like "pay 1k to mama mboga".

Never put this key in Vercel or anywhere in the website.

---

## Part E: Real M-Pesa payments (PayHero)

> ⚠️ **This part needs a developer.** The PayHero connection
> (`supabase/functions/_shared/payhero.ts`) was written **without access to PayHero's official
> documentation**. Before any real money, a developer must compare the six marked assumptions
> (**A1–A6** at the top of that file) with PayHero's API docs and fix any differences.

**You need:**
| What | Where to find it | Supabase secret name |
|------|------------------|----------------------|
| A PayHero account with M-Pesa STK Push enabled | https://payhero.co.ke | n/a |
| API username | PayHero dashboard, in the API keys / API credentials area | `PAYHERO_API_USERNAME` |
| API password | Same place as the username | `PAYHERO_API_PASSWORD` |
| Channel id (your till or paybill channel) | PayHero dashboard, in the payment channels area | `PAYHERO_CHANNEL_ID` |
| Callback address | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/webhooks/payhero` | `PAYHERO_CALLBACK_URL` |
| Callback token (a random secret) | Run `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | `PAYHERO_CALLBACK_TOKEN` |

If you can't find the API credentials or channel id, ask PayHero support where they are.

**Steps (after the developer check):**
1. Set the secrets in **sandbox** (test) mode and redeploy:
   ```bash
   npx supabase secrets set PROVIDER_MODE=sandbox PAYHERO_API_USERNAME=... PAYHERO_API_PASSWORD=... PAYHERO_CHANNEL_ID=... PAYHERO_CALLBACK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/webhooks/payhero PAYHERO_CALLBACK_TOKEN=...
   npx supabase functions deploy api --no-verify-jwt
   ```
2. On your website, pay **KES 1** to **your own phone**.
3. **What you should see:** an M-Pesa prompt on your phone. Enter your PIN. Within a few seconds the app changes from **pending** to **successful** and shows the M-Pesa receipt code.
4. Only when that works every time, consider `PROVIDER_MODE=live`, keeping `MAX_AMOUNT` low.

---

## Before you share the link
- [ ] `CORS_ORIGINS` is set to your website addresses (Part C, step 7).
- [ ] `MAX_AMOUNT` is low (default KES 1,000). There are no accounts, so anyone with the link can use it.
- [ ] Want it private? Set `DEMO_ACCESS_CODE=yourpasscode` and redeploy; visitors will be asked for it.
- [ ] No keys or passwords are in Vercel, GitHub or screenshots.
- [ ] You practised the [demo script](#demo-script-about-3-minutes) twice on a phone.

---

## Troubleshooting

| What you see | What it means | What to do |
|--------------|---------------|------------|
| **"Cannot reach the PesaPop API"** on your laptop | The backend isn't running | In the `PesaPop` folder run `npm run dev` and keep that terminal open |
| **"Cannot reach PesaPop"** on the Vercel site | Wrong `VITE_API_URL`, or the backend isn't deployed | Check `https://YOUR_PROJECT_REF.supabase.co/functions/v1/api/health` shows `{"status":"ok"}`. Check `VITE_API_URL` in Vercel → Settings → Environment Variables, then **Redeploy** |
| `docker: command not found`, or errors about the Docker daemon | Docker Desktop isn't installed or isn't open | Install it and open it, wait until it says running, then try again |
| `ECONNREFUSED 127.0.0.1:54329` | The local database isn't running | `docker start pesapop-db` |
| `docker run ... postgres:17` fails to download | Network or Docker login problem | Retry later, or sign in to Docker Desktop. Any Postgres 15+ image works |
| `Port 5173 is in use` | Another copy of the app is open | Use the address the terminal shows (e.g. 5174), or close the other terminal |
| `npm: command not found` | Node.js isn't installed | Install Node.js LTS, then **close and reopen** the terminal |
| Browser console says **CORS** | `CORS_ORIGINS` doesn't include the site you're on | Add that exact address (with `https://`) in Part C, step 7 |
| The page asks for a **passcode** | `DEMO_ACCESS_CODE` is set | Type it, or remove the secret and redeploy |
| **"Demo limit reached"** | Rate limit hit (5 payments per 10 minutes) | Wait, or raise `RATE_LIMIT_COUNT` and redeploy |
| Assistant says **"Basic mode"** | No Anthropic key | Part D (optional) |
| Payment shows **"Payments are not configured"** | Mode is sandbox/live but PayHero secrets are missing | Finish Part E, or set `PROVIDER_MODE=simulated` |

---

## Glossary
- **Frontend / website:** what people see in the browser. Lives in the `web` folder and is hosted on **Vercel**.
- **Backend / API:** the part that stores payments and talks to M-Pesa. Lives in `supabase/functions` and runs on **Supabase**.
- **Secret:** a private setting (key, password) stored in Supabase, never in the code.
- **STK Push:** the M-Pesa pop-up on a phone asking the owner to enter their PIN.
- **Simulated mode:** fake payments for demos. No prompt is sent and no money moves.
- **Sandbox:** PayHero's test mode. **Live:** real money.
- **Deploy:** upload the latest version so the internet sees it.

---

## Demo script (about 3 minutes)
1. Landing page: one sentence on the problem, tap **Try the demo**.
2. Open **Assistant**, type `send 500 to John`. Show the **Still needed** card.
3. Answer `0712 345 678`. Show the summary card: "Nothing has been paid yet."
4. Tap **Review and confirm**, then **Confirm**. Show pending, then success with the receipt.
5. Switch to **Merchant** (top of the page): the totals updated. Tap **Request payment** to send an M-Pesa prompt to a customer.
6. Close on safety: the AI never moves money; only an explicit Confirm does, and success only shows when M-Pesa confirms.

Keep a screen recording as a backup in case the internet or M-Pesa is down.

---

# For developers

## Architecture
```
 Web app (React + Vite)  ── hosted on Vercel, on your domain
        │  HTTPS  (X-Demo-Session: random id per browser, no accounts)
        ▼
 Supabase Edge Function "api"  ── the only backend
        ├─ Supabase Postgres   (RLS on, no grants: only the function can read/write)
        ├─ PayHero STK Push    (send prompt; PayHero calls back /webhooks/payhero)
        └─ Claude              (payment assistant; optional)
```

**Rules**
- The web app only calls the `api` function. It never calls Claude or PayHero.
- Only `POST /payments/{confirmation_id}/confirm` sends an STK push. It is idempotent: `payments.draft_id` is unique, so one draft can only ever create one payment.
- Never fake success. `simulated` mode is labelled on every page.
- No accounts: customers see only their own browser's payments. The Merchant view shows all demo payments for one shop, with other browsers' phone numbers masked.
- Abuse guards: amount cap, per-browser and per-IP rate limits, optional passcode.

## Repo layout
| Path | What it is |
|------|------------|
| `docs/openapi.yaml` | API contract (source of truth) |
| `supabase/migrations/` | Database schema |
| `supabase/functions/api/index.ts` | Edge Function entry point (Deno) |
| `supabase/functions/_shared/` | Backend logic (runs on Deno in Supabase and on Node locally) |
| `supabase/functions/_shared/payhero.ts` | PayHero adapter, **assumptions A1–A6 to verify** |
| `dev/` | Local dev server (`npm run dev:api`), runner for both (`npm run dev`), migrations (`npm run db:local`) |
| `tests/` | Backend tests: real Postgres, every response checked against the contract |
| `web/` | React frontend (`web/vercel.json` for Vercel) |

## Tests
```bash
# macOS / Linux
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop_test npm test   # backend: 29 tests
# Windows PowerShell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54329/pesapop_test"; npm test

cd web && npm test                                                                       # frontend: 19 tests
```
The backend tests wipe the `TEST_DATABASE_URL` database. Never point it at Supabase.

## Status
| Area | State |
|------|-------|
| Backend: drafts, idempotent confirm, history, merchant view, assistant, PayHero callback, abuse guards | Done, 29 tests |
| Frontend: landing, customer home, pay, assistant, status, history, merchant dashboard and requests | Done, 19 tests |
| Simulated payments | Done |
| PayHero sandbox/live | Written, **not verified** against PayHero's docs (Part E) |
