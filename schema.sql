-- ═══════════════════════════════════════════════════════════════════
-- SCHURCO SITE AUDIT — SUPABASE SCHEMA
-- Run this entire script once in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ── TABLES ──────────────────────────────────────────────────────────

create table if not exists public.organisations (
  id        uuid default gen_random_uuid() primary key,
  name      text not null,
  type      text default 'distributor' check (type in ('schurco','distributor')),
  country   text,
  region    text,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  org_id     uuid references public.organisations(id),
  name       text,
  role       text,
  company    text,
  country    text,
  region     text,
  is_admin   boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.audits (
  id                text primary key,
  org_id            uuid references public.organisations(id),
  user_id           uuid references auth.users(id),
  customer          text,
  site              text,
  region            text,
  country           text,
  date              text,
  rep_name          text,
  contact_name      text,
  contact_position  text,
  purpose           text,
  notes             text,
  location          jsonb,
  status            text default 'open',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.pumps (
  id              text primary key,
  audit_id        text references public.audits(id) on delete cascade,
  org_id          uuid references public.organisations(id),
  user_id         uuid references auth.users(id),
  tag             text,
  area            text,
  type            text,
  model           text,
  size            text,
  rpm             text,
  bearing         text,
  bearing_raw     text,
  bearing_source  text,
  drive           text,
  kw              text,
  kw_raw          text,
  liner           text,
  impeller        text,
  throat          text,
  seal            text,
  slurry          text,
  sg              text,
  ph              text,
  temp            text,
  solids          text,
  flow            text,
  head            text,
  d50             text,
  dmax            text,
  condition       text,
  wear            text,
  spares          text,
  competitor      text,
  opp             text,
  notes           text,
  photos_meta     jsonb,
  extra_count     integer default 0,
  saved_at        bigint,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists public.opportunities (
  id            text primary key,
  audit_id      text references public.audits(id) on delete cascade,
  pump_id       text,
  org_id        uuid references public.organisations(id),
  user_id       uuid references auth.users(id),
  title         text,
  customer      text,
  site          text,
  value         text,
  stage         text,
  owner         text,
  close_date    text,
  contact_name  text,
  contact_role  text,
  notes         text,
  saved_at      bigint,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────

alter table public.organisations  enable row level security;
alter table public.profiles        enable row level security;
alter table public.audits          enable row level security;
alter table public.pumps           enable row level security;
alter table public.opportunities   enable row level security;

-- Helper: get current user's org
create or replace function public.my_org_id()
returns uuid language sql security definer stable as
$$ select org_id from public.profiles where id = auth.uid() $$;

-- Helper: is current user admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- Organisations
create policy "org_read"   on public.organisations for select using (public.is_admin() or id = public.my_org_id());
create policy "org_admin"  on public.organisations for all    using (public.is_admin());

-- Profiles
create policy "profile_read"   on public.profiles for select using (public.is_admin() or org_id = public.my_org_id());
create policy "profile_own"    on public.profiles for insert with check (id = auth.uid());
create policy "profile_update" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- Audits
create policy "audit_read"   on public.audits for select using (public.is_admin() or org_id = public.my_org_id());
create policy "audit_insert" on public.audits for insert with check (user_id = auth.uid() and org_id = public.my_org_id());
create policy "audit_update" on public.audits for update using (user_id = auth.uid() or public.is_admin());
create policy "audit_delete" on public.audits for delete using (user_id = auth.uid() or public.is_admin());

-- Pumps
create policy "pump_read"   on public.pumps for select using (public.is_admin() or org_id = public.my_org_id());
create policy "pump_insert" on public.pumps for insert with check (user_id = auth.uid() and org_id = public.my_org_id());
create policy "pump_update" on public.pumps for update using (user_id = auth.uid() or public.is_admin());
create policy "pump_delete" on public.pumps for delete using (user_id = auth.uid() or public.is_admin());

-- Opportunities
create policy "opp_read"   on public.opportunities for select using (public.is_admin() or org_id = public.my_org_id());
create policy "opp_insert" on public.opportunities for insert with check (user_id = auth.uid() and org_id = public.my_org_id());
create policy "opp_update" on public.opportunities for update using (user_id = auth.uid() or public.is_admin());
create policy "opp_delete" on public.opportunities for delete using (user_id = auth.uid() or public.is_admin());

-- ── AUTO-CREATE PROFILE ON USER SIGNUP ───────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, created_at, updated_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    now(), now()
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════
-- INITIAL DATA — Run AFTER creating your Supabase account
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create Schurco SA organisation
insert into public.organisations (name, type, country, region)
values ('Schurco Slurry South Africa', 'schurco', 'South Africa', 'Gauteng')
on conflict do nothing;

-- 2. After Gideon logs in for the first time, run this block
--    (replace the email with your actual login email):
--
-- update public.profiles
-- set org_id   = (select id from public.organisations where name = 'Schurco Slurry South Africa'),
--     is_admin = true,
--     name     = 'Gideon',
--     role     = 'Sales Manager',
--     company  = 'Schurco Slurry South Africa',
--     country  = 'South Africa',
--     region   = 'Gauteng'
-- where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');

-- ═══════════════════════════════════════════════════════════════════
-- TO ADD A DISTRIBUTOR ORGANISATION later:
-- insert into public.organisations (name,type,country,region)
-- values ('Distributor Name','distributor','Angola','Luanda');
-- ═══════════════════════════════════════════════════════════════════
