"""Database access. A single asyncpg pool created lazily at first use."""

import os
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


async def pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=5)
    return _pool


async def fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args: Any) -> str:
    p = await pool()
    async with p.acquire() as conn:
        return await conn.execute(query, *args)
