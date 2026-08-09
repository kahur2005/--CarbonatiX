-- Monthly production logs: one editable draft per user per calendar month.
-- Operational inputs may be partial (autosave mid-edit). Site-spec stays on
-- companies. calculation_runs.period stamps which month a commit was for.

create table public.production_months (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    company_id  uuid not null references public.companies(id) on delete cascade,
    -- Always the first day of the month (enforced by check below).
    period      date not null,
    inputs      jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    unique (user_id, period),
    check (period = (date_trunc('month', period::timestamp))::date)
);

create index on public.production_months (user_id, period desc);

alter table public.calculation_runs
    add column period date null;

alter table public.production_months enable row level security;

create policy own_production_months on public.production_months
    for all
    to authenticated
    using ( (select auth.uid()) = user_id )
    with check ( (select auth.uid()) = user_id );
