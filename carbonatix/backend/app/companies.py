"""Company profile persistence and lookups.

RLS is inert on this backend's database connection (it connects as the
`postgres` superuser, which Postgres exempts from RLS unconditionally; see
`supabase/migrations/0001_init.sql`). Tenant isolation is therefore entirely
these `where user_id = $N` clauses -- every query in this module filters by
`user_id`, reads and writes alike.
"""

from uuid import UUID

from fastapi import HTTPException, status

from . import db
from .schemas import CompanyRequest, CompanyResponse

__all__ = ["fetch", "require", "save", "to_response"]


async def fetch(user_id: UUID):
    """The caller's own company row, or None if they haven't onboarded yet.

    Never looks up by anything but the caller's own user_id, so there is no
    parameter through which another tenant's row could be requested.
    """
    return await db.fetchrow("select * from public.companies where user_id = $1", user_id)


async def require(user_id: UUID):
    """Same lookup as `fetch`, but raises 409 on a miss.

    Used by routes that need the profile to do their job (running the
    calculator, suggesting a cap): there, a missing profile is the caller's
    own unfinished setup, not a request for a nonexistent resource -- hence
    409, not 404.
    """
    row = await fetch(user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No company profile. Complete onboarding first.",
        )
    return row


async def save(user_id: UUID, req: CompanyRequest) -> None:
    """Upsert the caller's own company profile.

    `on conflict (user_id)` relies on the table's `unique (user_id)`
    constraint (one company per user), and the update targets only the row
    that constraint matched -- there is no separate `where user_id = ...` to
    write for the update branch, because the conflict target already pins it
    to this user's row.
    """
    await db.execute(
        """
        insert into public.companies (
            user_id, name, technology, ef_captive_pltu, dryer_thermal_efficiency,
            sec_eaf_kwh_per_t_alloy, alloy_nickel_grade, kiln_thermal_efficiency,
            cap_tco2e
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (user_id) do update set
            name = excluded.name,
            technology = excluded.technology,
            ef_captive_pltu = excluded.ef_captive_pltu,
            dryer_thermal_efficiency = excluded.dryer_thermal_efficiency,
            sec_eaf_kwh_per_t_alloy = excluded.sec_eaf_kwh_per_t_alloy,
            alloy_nickel_grade = excluded.alloy_nickel_grade,
            kiln_thermal_efficiency = excluded.kiln_thermal_efficiency,
            cap_tco2e = excluded.cap_tco2e
        """,
        user_id,
        req.name,
        req.technology,
        req.ef_captive_pltu,
        req.dryer_thermal_efficiency,
        req.sec_eaf_kwh_per_t_alloy,
        req.alloy_nickel_grade,
        req.kiln_thermal_efficiency,
        req.cap_tco2e,
    )


def to_response(row) -> CompanyResponse:
    return CompanyResponse(**dict(row))
