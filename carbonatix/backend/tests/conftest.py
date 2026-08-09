"""In-memory stand-in for Postgres. The commit contract is what these tests
check; Postgres itself is exercised by the E2E test in Task 20.

The fake keys `companies` by user_id and, for `calculation_runs`, checks the
stored row's `user_id` against the `user_id` argument the caller passed to
`fetchrow` -- so a handler that forgets to pass (or forgets to require a
match on) `user_id` is exactly what breaks here, not something the fake
papers over.

That argument-level check alone is not enough: it only exercises the value
passed as an argument, never the SQL text, so a query whose WHERE clause
combined `user_id` with `or` instead of `and` -- still passing the correct
arguments, and therefore invisible to an argument-only check -- would leak
in real Postgres while this fake kept reporting isolation as intact.
`_assert_tenant_scoped` below closes that gap by inspecting the query text
itself for every query against `companies`, `calculation_runs`, or
`production_months`. It is a shape check, not a SQL parser: it cannot
verify a query's logic is *otherwise* correct, only that it is not
structurally incapable of isolating tenants. A real end-to-end test against
Postgres (Task 20) remains the only true backstop for SQL semantics this
fake cannot model.
"""

import json
import uuid
from datetime import datetime

import pytest

from app import db


def _assert_tenant_scoped(query: str) -> None:
    """Refuse to fake-serve a query against tenant tables unless its own
    text scopes it by user_id.

    Generic by design -- a rule about the *shape* a user-scoped query must
    have, not a hardcoded list of expected SQL strings (which would break on
    every harmless reformatting of a query that is still correctly scoped).
    """
    q = " ".join(query.lower().split())
    is_companies = "public.companies" in q
    is_runs = "public.calculation_runs" in q
    is_months = "public.production_months" in q
    if not (is_companies or is_runs or is_months):
        return

    if q.startswith("insert"):
        # A plain insert has no predicate to inspect; whether the inserted
        # row actually carries the caller's own user_id is checked via the
        # arguments in fake_execute below. The companies upsert is the one
        # insert that *is* also an implicit update, so its scope comes from
        # the conflict target rather than a WHERE clause.
        if is_companies and "on conflict (user_id)" not in q:
            raise AssertionError(
                f"companies upsert is not scoped to a single user_id row: {query!r}"
            )
        if is_months and "on conflict (user_id, period)" not in q:
            raise AssertionError(
                f"production_months upsert is not scoped to (user_id, period): {query!r}"
            )
        return

    if "user_id" not in q:
        raise AssertionError(f"query against a tenant table has no user_id predicate: {query!r}")
    if " or " in q:
        raise AssertionError(
            "query against a tenant table combines predicates with OR -- "
            f"a user_id filter joined by OR does not isolate tenants: {query!r}"
        )


@pytest.fixture
def fake_db(monkeypatch):
    companies: dict[uuid.UUID, dict] = {}
    runs: dict[uuid.UUID, dict] = {}
    months: dict[tuple[uuid.UUID, object], dict] = {}

    async def fake_fetchrow(query, *args):
        _assert_tenant_scoped(query)
        if "from public.companies" in query:
            return companies.get(args[0])
        if "from public.calculation_runs" in query:
            row = runs.get(args[0])
            return row if row and row["user_id"] == args[1] else None
        if "from public.production_months" in query:
            # get_month: where user_id = $1 and period = $2
            return months.get((args[0], args[1]))
        return None

    async def fake_fetch(query, *args):
        _assert_tenant_scoped(query)
        if "from public.production_months" in query:
            user_id = args[0]
            rows = [row for (uid, _), row in months.items() if uid == user_id]
            rows.sort(key=lambda r: r["period"], reverse=True)
            return rows
        return []

    async def fake_execute(query, *args):
        _assert_tenant_scoped(query)
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
                "period": args[8] if len(args) > 8 else None,
            }
        elif "insert into public.production_months" in query:
            # (user_id, company_id, period, inputs, updated_at)
            user_id, company_id, period, inputs_json, updated_at = args[:5]
            inputs = json.loads(inputs_json) if isinstance(inputs_json, str) else inputs_json
            months[(user_id, period)] = {
                "user_id": user_id,
                "company_id": company_id,
                "period": period,
                "inputs": inputs,
                "updated_at": updated_at
                if isinstance(updated_at, datetime)
                else datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")),
            }
        return "OK"

    monkeypatch.setattr(db, "fetchrow", fake_fetchrow)
    monkeypatch.setattr(db, "fetch", fake_fetch)
    monkeypatch.setattr(db, "execute", fake_execute)
    yield
