# @thynkpdf/editor-client
Typed client for the THYNKPDF API. `docs/openapi.json` was not present when this was written, so
`src/types.ts` mirrors the agreed shapes by hand and `src/mocks/` holds an isolated in-memory mock.
Once the backend publishes `docs/openapi.json`, run `pnpm --filter @thynkpdf/editor-client gen` to
generate `src/generated/schema.d.ts` and replace hand types. Rotate route `/documents/{id}/versions/{vid}/pages/rotate` is ASSUMED.
