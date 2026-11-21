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

## Quick start

```bash
cd mock && npm install && npm start   # mock API on http://localhost:4000
```
