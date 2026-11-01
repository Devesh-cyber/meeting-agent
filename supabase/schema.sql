-- =====================================================================
-- Minutes · Phase 1 (personal) — run in your EXISTING Supabase project.
-- It only ADDS new tables, a private 'audio' bucket and security rules.
-- The hackathon tables (meetings, decisions, action_items, people) and the
-- 'recordings' bucket are not touched, so the live demo keeps working.
-- SQL Editor → paste everything → Run. Safe to re-run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- you ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text,
  summary_style text not null default 'short' check (summary_style in ('short','detailed')),
  remind_minutes int not null default 30 check (remind_minutes between 0 and 1440),
  allday_hour int not null default 9 check (allday_hour between 0 and 23),
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz default now()
);

-- ---------- categories (Work, Networking, Clients, Personal, …) ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#6f6a60' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- ---------- entries: one per recording, upload or note ----------
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('meeting','conversation','note')),
  title text,
  title_locked boolean not null default false,   -- true once you rename it; the AI won't overwrite
  category_id uuid references public.categories(id) on delete set null,
  started_at timestamptz not null default now(),
  duration_sec int,
  audio_path text,
  job_id text,                                    -- transcription job
  transcript jsonb,                               -- [{speaker, text}]
  speaker_map jsonb not null default '{}',
  note_text text,
  summary text,
  status text not null default 'processing' check (status in ('processing','finalizing','ready','failed')),
  error text,
  created_at timestamptz default now()
);

-- ---------- items: tasks and calendar events in one table ----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete set null,
  kind text not null default 'task' check (kind in ('task','event')),
  title text not null check (char_length(title) between 1 and 300),
  notes text,
  owner text,                                     -- who does it, if not you ("waiting on Priya")
  category_id uuid references public.categories(id) on delete set null,
  due_date date,
  due_time time,                                  -- null = all day
  end_time time,
  status text not null default 'open' check (status in ('suggested','open','done')),
  remind_offset_min int,                          -- null = your default, -1 = no reminder
  remind_at timestamptz,                          -- worked out by the trigger below
  reminded_at timestamptz,
  nudged_at timestamptz,
  done_at timestamptz,
  created_at timestamptz default now()
);

-- ---------- decisions, with conflicts against your earlier ones ----------
create table if not exists public.entry_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete cascade,
  text text not null,
  made_by text,
  status text not null default 'active' check (status in ('active','superseded')),
  superseded_by uuid references public.entry_decisions(id) on delete set null,
  conflict_with uuid references public.entry_decisions(id) on delete set null,
  conflict_note text,
  created_at timestamptz default now()
);

-- ---------- phones and laptops that get push reminders ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz default now()
);

create index if not exists entries_user_idx  on public.entries(user_id, started_at desc);
create index if not exists entries_job_idx   on public.entries(job_id);
create index if not exists items_user_idx    on public.items(user_id, due_date);
create index if not exists items_remind_idx  on public.items(remind_at) where status = 'open' and reminded_at is null;
create index if not exists entry_decisions_user_idx on public.entry_decisions(user_id, created_at desc);

-- ---------- reminder time, in your own time zone ----------
create or replace function public.compute_remind_at() returns trigger
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = new.user_id;
  if new.status <> 'open' or new.due_date is null or coalesce(new.remind_offset_min, 0) < 0 then
    new.remind_at := null;
  elsif new.due_time is not null then
    new.remind_at := ((new.due_date + new.due_time) at time zone coalesce(p.timezone, 'Asia/Kolkata'))
                     - make_interval(mins => coalesce(new.remind_offset_min, p.remind_minutes, 30));
  else
    new.remind_at := ((new.due_date + make_time(coalesce(p.allday_hour, 9), 0, 0)) at time zone coalesce(p.timezone, 'Asia/Kolkata'));
  end if;
  if tg_op = 'UPDATE' then
    if new.remind_at is distinct from old.remind_at then new.reminded_at := null; end if;
    if new.due_date is distinct from old.due_date then new.nudged_at := null; end if;
    if new.status = 'done' and old.status <> 'done' then new.done_at := now(); end if;
    if new.status <> 'done' then new.done_at := null; end if;
  elsif new.status = 'done' then
    new.done_at := now();
  end if;
  return new;
end $$;

drop trigger if exists items_remind on public.items;
create trigger items_remind before insert or update of status, due_date, due_time, remind_offset_min on public.items
  for each row execute function public.compute_remind_at();

-- When you change your reminder defaults or time zone, re-time your open items
create or replace function public.retime_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.timezone is distinct from old.timezone or new.remind_minutes is distinct from old.remind_minutes
     or new.allday_hour is distinct from old.allday_hour then
    update items set due_time = due_time where user_id = new.id and status = 'open';
  end if;
  return new;
end $$;
drop trigger if exists profiles_retime on public.profiles;
create trigger profiles_retime after update on public.profiles for each row execute function public.retime_items();

-- ---------- new account: profile + starter categories ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, timezone)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
          lower(new.email),
          coalesce(nullif(new.raw_user_meta_data->>'timezone', ''), 'Asia/Kolkata'))
  on conflict (id) do nothing;
  insert into categories (user_id, name, color, sort) values
    (new.id, 'Work',       '#3b6fb6', 1),
    (new.id, 'Networking', '#c47a2b', 2),
    (new.id, 'Clients',    '#8b5cb8', 3),
    (new.id, 'Personal',   '#5f8a3a', 4)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- privacy: you only ever see your own rows ----------
alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.entries            enable row level security;
alter table public.items              enable row level security;
alter table public.entry_decisions          enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('profiles','categories','entries','items','entry_decisions','push_subscriptions')
  loop execute format('drop policy %I on public.%I', p.policyname, p.tablename); end loop;
end $$;

create policy own_profile_read   on public.profiles for select to authenticated using (id = auth.uid());
create policy own_profile_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy own_categories on public.categories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_entries    on public.entries    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_items      on public.items      for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_entry_decisions on public.entry_decisions  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_push       on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.profiles, public.categories, public.entries, public.items, public.entry_decisions, public.push_subscriptions from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.categories, public.entries, public.items, public.entry_decisions, public.push_subscriptions to authenticated;

-- ---------- private audio, one folder per user ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 104857600, array['audio/*','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 104857600,
  allowed_mime_types = array['audio/*','video/mp4','video/webm'];

drop policy if exists audio_insert on storage.objects;
drop policy if exists audio_read on storage.objects;
drop policy if exists audio_delete on storage.objects;
create policy audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and split_part(name, '/', 1) = auth.uid()::text);
create policy audio_read on storage.objects for select to authenticated
  using (bucket_id = 'audio' and split_part(name, '/', 1) = auth.uid()::text);
create policy audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and split_part(name, '/', 1) = auth.uid()::text);
