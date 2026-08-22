# Lecture-to-Study Kit

A local-first study workspace that turns lecture materials into a focused review plan, practice exam, and interactive flashcards.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/study-kit/src/App.tsx` — app routes and study modes
- `artifacts/study-kit/src/lib/kit-store.ts` — IndexedDB persistence boundary
- `lib/api-spec/openapi.yaml` — generation contract source of truth
- `artifacts/api-server/src/routes/study.ts` — generation and tutor routes

## Architecture decisions

- Kit content and progress are intentionally separate; content can be regenerated without resetting study state.
- IndexedDB is the persistence boundary for a later server-backed storage migration; localStorage remains a compatibility fallback for the first browser load.
- The API uses AI SDK structured generation when managed AI Gateway variables are available and a deterministic material-derived starter when they are not.
- Lecture audio is intentionally disabled in the first release.

## Product

- Upload slide PDFs, text notes, and pasted material; PDF text is extracted in-browser.
- Generate chapter summaries, a seven-day review plan, mapped practice questions, and flashcards through `/api/generate-kit`.
- Review progress is stored separately from kit content in the browser so regeneration does not erase checkboxes or scores.
- A streaming `/api/tutor` route supports “explain differently” prompts.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
