"""In-memory stand-in for Postgres. The commit contract is what these tests
check; Postgres itself is exercised by the E2E test in Task 20.

The fake keys `companies` by user_id and, for `calculation_runs`, checks the
stored row's `user_id` against the `user_id` argument the caller passed to
`fetchrow` -- so a handler that forgets to pass (or forgets to require a
match on) `user_id` is exactly what breaks here, not something the fake
papers over.
"""

import uuid

import pytest

from app import db


@pytest.fixture
def fake_db(monkeypatch):
    companies: dict[uuid.UUID, dict] = {}
    runs: dict[uuid.UUID, dict] = {}

    async def fake_fetchrow(query, *args):
        if "from public.companies" in query:
            return companies.get(args[0])
        if "from public.calculation_runs" in query:
            row = runs.get(args[0])
            return row if row and row["user_id"] == args[1] else None
        return None

    async def fake_execute(query, *args):
        if "insert into public.companies" in query:
            companies[args[0]] = {
                "id": uuid.uuid4(),
                "user_id": args[0],
                "name": args[1],
                "technology": args[2],
                "ef_captive_pltu": args[3],
                "dryer_thermal_efficiency": args[4],
                "sec_eaf_kwh_per_t_alloy": args[5],
                "alloy_nickel_grade": args[6],
                "kiln_thermal_efficiency": args[7],
                "cap_tco2e": args[8],
            }
        elif "insert into public.calculation_runs" in query:
            runs[args[0]] = {
                "id": args[0],
                "user_id": args[1],
                "company_id": args[2],
                "inputs": args[3],
                "result": args[4],
                "compliance": args[5],
                "forecast_snapshot": args[6],
                "created_at": args[7],
            }
        return "OK"

    monkeypatch.setattr(db, "fetchrow", fake_fetchrow)
    monkeypatch.setattr(db, "execute", fake_execute)
    yield
