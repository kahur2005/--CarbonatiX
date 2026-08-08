"""Database access. A single asyncpg pool created lazily at first use.

Connects through Supabase's *transaction* pooler (Supavisor, port 6543), not
the direct database host: `db.<ref>.supabase.co` resolves to IPv6 only, and
neither the development machines nor most Indonesian ISPs have IPv6 egress,
so the direct host is simply unreachable. The pooler's session mode (5432)
would be the closer match to a normal Postgres connection, but it times out
from here too; 6543 is what actually connects.

`statement_cache_size=0` is load-bearing under that pooler and must not be
removed. A transaction pooler multiplexes many client connections onto few
server connections, handing a given backend to a different client after each
transaction. asyncpg's default behaviour is to PREPARE each distinct query
once and reuse it by name; the prepared statement lives on the server
connection, so the next query arrives on a backend where that name does not
exist -- or, worse, where a *different* client's statement holds the name.
The failure is intermittent (`prepared statement "__asyncpg_stmt_1__" does
not exist`) and appears only under concurrency, which is to say: not during
a single-user demo, and reliably during a judged one.
"""

import os
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            os.environ["DATABASE_URL"],
            min_size=1,
            max_size=5,
            statement_cache_size=0,  # required by the transaction pooler; see module docstring
        )
    return _pool


async def fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args: Any) -> str:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.execute(query, *args)
