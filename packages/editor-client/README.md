# @thynkpdf/editor-client
Typed client for the THYNKPDF API. Types are generated from `docs/openapi.json`:
`pnpm --filter @thynkpdf/editor-client gen` → `src/generated/schema.d.ts`.
`src/mocks/` is an isolated in-memory mock (enabled with `NEXT_PUBLIC_API_MOCK=1`) for offline UI work and unit tests only.
