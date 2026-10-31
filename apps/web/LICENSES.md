# Third-party licenses — THYNKPDF web (apps/web + frontend packages)
No Adobe (or other third-party) branding, icons, or assets are used. The THYNKPDF wordmark/page glyph (packages/ui/src/Wordmark.tsx) is original.

| Package | Use | License |
|---|---|---|
| pdfjs-dist 4.10.38 (Mozilla PDF.js) | PDF rendering, text layer, `pdf_viewer.css` | Apache-2.0 |
| next 15 | App framework | MIT |
| react / react-dom 19 | UI | MIT |
| tailwindcss 3, postcss, autoprefixer | Styling | MIT |
| @radix-ui/react-tooltip (+ dropdown-menu, tabs installed) | Accessible primitives | MIT |
| zustand | State | MIT |
| @tanstack/react-query, @tanstack/react-virtual | Data / virtualization | MIT |
| clsx | classnames | MIT |
| pdf-lib | Mock API page ops, test fixture generation | MIT |
| openapi-typescript (dev) | Client type generation | MIT |
| vitest, @vitejs/plugin-react, jsdom, @testing-library/* (dev) | Unit/component tests | MIT |
| @playwright/test (dev) | E2E | Apache-2.0 |
| typescript (dev) | Type checking | Apache-2.0 |
Glyph icons in the toolbar are Unicode characters rendered by system fonts.

Test-only (packages/frontend-tests, not shipped): @axe-core/playwright (MPL-2.0), pikepdf (MPL-2.0, wraps qpdf Apache-2.0) and pypdf (BSD-3-Clause) in a local Python venv for third-party PDF verification.
