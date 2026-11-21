-- PesaPop demo schema. Only the `api` Edge Function (connecting as the database owner)
-- reads or writes these tables. RLS is enabled with NO policies and table grants are
-- revoked from anon/authenticated, so the public Supabase REST API cannot touch them.

create table public.payment_drafts (
  id          text primary key,                 -- the confirmation_id
  session_id  text not null,                    -- anonymous demo browser id
  kind        text not null check (kind in ('payment', 'request')),
  amount      integer not null check (amount >= 1),
  fee         integer not null default 0 check (fee >= 0),
  phone       text not null check (phone ~ '^\+254(7|1)[0-9]{8}$'),
  recipient   text not null,
  reference   text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index payment_drafts_session_idx on public.payment_drafts (session_id);

create table public.payments (
  id                 text primary key,
  draft_id           text not null unique references public.payment_drafts (id), -- one draft -> one payment (idempotent confirm)
  session_id         text not null,
  ip_hash            text not null,
  kind               text not null check (kind in ('payment', 'request')),
  status             text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  amount             integer not null check (amount >= 1),
  fee                integer not null default 0,
  phone              text not null,
  recipient          text not null,
  reference          text,
  provider           text not null,            -- 'payhero' | 'simulated'
  provider_reference text,                     -- PayHero CheckoutRequestID / reference
  mpesa_receipt      text,
  paid_at            timestamptz,
  failure_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index payments_session_idx on public.payments (session_id, created_at desc);
create index payments_created_idx on public.payments (created_at desc);
create index payments_ip_idx on public.payments (ip_hash, created_at desc);
create index payments_provider_ref_idx on public.payments (provider_reference);

create table public.conversations (
  id          text primary key,
  session_id  text not null,
  created_at  timestamptz not null default now()
);
create index conversations_session_idx on public.conversations (session_id);

create table public.messages (
  id               text primary key,
  conversation_id  text not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.payment_drafts enable row level security;
alter table public.payments       enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.payment_drafts, public.payments, public.conversations, public.messages from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.payment_drafts, public.payments, public.conversations, public.messages from authenticated;
  end if;
end $$;
