# SmartSmelt ERP — Frontend

Next.js 16 App Router UI for SmartSmelt (Bahasa Indonesia product copy).

## Dev

```bash
npm run dev   # :3000
npx vitest run
npx tsc --noEmit
npm run lint
```

Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Routes

| Path | Role |
|------|------|
| `/login`, `/register` | Supabase auth |
| `/onboarding` | Site spec + OCR |
| `/twin` | Photoreal GLB twin + operational input side panel |
| `/dashboard?run=` | Emissions, compliance, forecast snapshot, advisor SSE |
| `/workflow` | 3-layer AI workflow canvas (visual / dummy) |

## UI reference

Layout/visual system follows the local clone at repo-root `refs/smartsmelt-ui-layout-demo` (gitignored). Undeveloped demo surfaces (IDX order book, what-if, peer meters) render with a **DUMMY** badge and do not call the backend.

The GLB site model lives at `public/models/thermal_power_plant__cooling_tower.glb`.

Read `AGENTS.md` and `node_modules/next/dist/docs/` before changing App Router / `proxy.ts` patterns.
