"""Monthly production logs — one editable draft per user per calendar month.

RLS is inert on this backend's connection (see `companies.py`); every query
filters by `user_id`. Inputs may be partial so twin autosave can persist
mid-edit incomplete power mixes.
"""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from . import companies, db

__all__ = [
    "EARLIEST_PERIOD",
    "list_months",
    "get_month",
    "upsert_month",
    "parse_period_param",
    "period_to_wire",
]

EARLIEST_PERIOD = date(2025, 1, 1)
_PERIOD_RE = re.compile(r"^(\d{4})-(\d{2})$")

# Wire keys that may appear in a partial draft. Values are fractions/tons
# when present; missing keys mean the twin field is blank.
_INPUT_KEYS = frozenset(
    {
        "wetOreInputTons",
        "moistureContentPct",
        "nickelGradePct",
        "reductantBiocokePct",
        "powerMixCaptiveCoal",
        "powerMixHydroGrid",
    }
)


def _current_month_start(today: date | None = None) -> date:
    d = today or datetime.now(UTC).date()
    return date(d.year, d.month, 1)


def parse_period_param(yyyy_mm: str, *, today: date | None = None) -> date:
    """Parse `YYYY-MM` into first-of-month, or 422 if malformed / out of range."""
    m = _PERIOD_RE.match(yyyy_mm)
    if not m:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="period must be YYYY-MM",
        )
    year, month = int(m.group(1)), int(m.group(2))
    if month < 1 or month > 12:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="period must be YYYY-MM",
        )
    period = date(year, month, 1)
    latest = _current_month_start(today)
    if period < EARLIEST_PERIOD or period > latest:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"period must be between {EARLIEST_PERIOD.isoformat()[:7]} and {latest.isoformat()[:7]}",
        )
    return period


def period_to_wire(period: date) -> str:
    return f"{period.year:04d}-{period.month:02d}"


def _has_inputs(inputs: dict[str, Any]) -> bool:
    return any(k in _INPUT_KEYS and inputs[k] is not None for k in inputs)


def _sanitize_partial_inputs(raw: dict[str, Any]) -> dict[str, Any]:
    """Keep only known operational keys with finite numbers. Partial OK."""
    out: dict[str, Any] = {}
    for key in _INPUT_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if value is None:
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"inputs.{key} must be a number",
            )
        f = float(value)
        if not math.isfinite(f):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"inputs.{key} must be finite",
            )
        out[key] = f
    return out


async def list_months(user_id: UUID) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        select period, updated_at, inputs
        from public.production_months
        where user_id = $1
        order by period desc
        """,
        user_id,
    )
    result = []
    for row in rows:
        inputs = row["inputs"]
        if isinstance(inputs, str):
            inputs = json.loads(inputs)
        result.append(
            {
                "period": period_to_wire(row["period"]),
                "updatedAt": row["updated_at"].isoformat(),
                "hasInputs": _has_inputs(inputs or {}),
            }
        )
    return result


async def get_month(user_id: UUID, yyyy_mm: str) -> dict[str, Any]:
    period = parse_period_param(yyyy_mm)
    row = await db.fetchrow(
        """
        select period, inputs, updated_at
        from public.production_months
        where user_id = $1 and period = $2
        """,
        user_id,
        period,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No production log for this month")
    inputs = row["inputs"]
    if isinstance(inputs, str):
        inputs = json.loads(inputs)
    return {
        "period": period_to_wire(row["period"]),
        "inputs": inputs or {},
        "updatedAt": row["updated_at"].isoformat(),
    }


async def upsert_month(user_id: UUID, yyyy_mm: str, inputs_raw: dict[str, Any]) -> dict[str, Any]:
    period = parse_period_param(yyyy_mm)
    company = await companies.require(user_id)
    inputs = _sanitize_partial_inputs(inputs_raw)
    now = datetime.now(UTC)
    await db.execute(
        """
        insert into public.production_months
            (user_id, company_id, period, inputs, updated_at)
        values ($1, $2, $3, $4::jsonb, $5)
        on conflict (user_id, period) do update set
            inputs = excluded.inputs,
            company_id = excluded.company_id,
            updated_at = excluded.updated_at
        """,
        user_id,
        company["id"],
        period,
        json.dumps(inputs),
        now,
    )
    return {
        "period": period_to_wire(period),
        "inputs": inputs,
        "updatedAt": now.isoformat(),
    }
