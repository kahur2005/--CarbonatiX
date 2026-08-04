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
itself for every query against `companies` or `calculation_runs`. It is a
shape check, not a SQL parser: it cannot verify a query's logic is
*otherwise* correct, only that it is not structurally incapable of
isolating tenants. A real end-to-end test against Postgres (Task 20)
remains the only true backstop for SQL semantics this fake cannot model.
"""

import uuid

import pytest

from app import db


def _assert_tenant_scoped(query: str) -> None:
    """Refuse to fake-serve a query against companies/calculation_runs
    unless its own text scopes it by user_id.

    Generic by design -- a rule about the *shape* a user-scoped query must
    have, not a hardcoded list of expected SQL strings (which would break on
    every harmless reformatting of a query that is still correctly scoped).
    """
    q = " ".join(query.lower().split())
    is_companies = "public.companies" in q
    is_runs = "public.calculation_runs" in q
    if not (is_companies or is_runs):
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

    async def fake_fetchrow(query, *args):
        _assert_tenant_scoped(query)
        if "from public.companies" in query:
            return companies.get(args[0])
        if "from public.calculation_runs" in query:
            row = runs.get(args[0])
            return row if row and row["user_id"] == args[1] else None
        return None

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
            }
        return "OK"

    monkeypatch.setattr(db, "fetchrow", fake_fetchrow)
    monkeypatch.setattr(db, "execute", fake_execute)
    yield
