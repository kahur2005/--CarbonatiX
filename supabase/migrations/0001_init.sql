-- Company profile: one per user. Holds the site specification, which changes
-- rarely, and the absolute carbon allocation for the period.
create table public.companies (
    id                          uuid primary key default gen_random_uuid(),
    user_id                     uuid not null references auth.users(id) on delete cascade,
    name                        text not null,
    technology                  text not null default 'RKEF',
    -- Site specification
    ef_captive_pltu             double precision not null,
    dryer_thermal_efficiency    double precision not null,
    sec_eaf_kwh_per_t_alloy     double precision not null,
    alloy_nickel_grade          double precision not null default 0.10,
    kiln_thermal_efficiency     double precision not null default 0.55,
    -- Absolute allocation in tCO2e for the period. NOT derived from ore volume.
    cap_tco2e                   double precision not null,
    created_at                  timestamptz not null default now(),
    unique (user_id)
);

-- An immutable committed snapshot. Stores the forecast it was computed
-- against rather than joining live: otherwise reopening yesterday's run would
-- show yesterday's emissions against today's carbon price, and the rupiah
-- figure on screen would stop matching the one the advisor was given.
create table public.calculation_runs (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    company_id          uuid not null references public.companies(id) on delete cascade,
    inputs              jsonb not null,
    result              jsonb not null,
    compliance          jsonb not null,
    forecast_snapshot   jsonb not null,
    created_at          timestamptz not null default now()
);
create index on public.calculation_runs (user_id, created_at desc);

create table public.recommendations (
    id          uuid primary key default gen_random_uuid(),
    run_id      uuid not null references public.calculation_runs(id) on delete cascade,
    steps       jsonb not null,
    body        text,
    citations   jsonb not null default '[]'::jsonb,
    model       text not null,
    confidence  double precision,
    failed      boolean not null default false,
    created_at  timestamptz not null default now()
);
create index on public.recommendations (run_id);

create table public.documents (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    storage_key text not null,
    profile     text not null check (profile in ('site_spec', 'operational')),
    extraction  jsonb not null default '{}'::jsonb,
    accepted    boolean not null default false,
    created_at  timestamptz not null default now()
);

-- Historical price series. Seeded once, used for training and for chart context.
create table public.price_history (
    observed_on             date primary key,
    lme_usd_per_ton         double precision,
    idx_carbon_idr_per_ton  double precision
);

create table public.forecasts (
    id              uuid primary key default gen_random_uuid(),
    generated_on    date not null,
    horizon_days    integer not null,
    series          jsonb not null,
    unique (generated_on, horizon_days)
);

alter table public.companies          enable row level security;
alter table public.calculation_runs   enable row level security;
alter table public.recommendations    enable row level security;
alter table public.documents          enable row level security;

create policy own_company on public.companies
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_runs on public.calculation_runs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_documents on public.documents
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_recommendations on public.recommendations
    for all using (
        exists (select 1 from public.calculation_runs r
                where r.id = run_id and r.user_id = auth.uid())
    );
