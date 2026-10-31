# Licensing assessment (engineering view — not legal advice; confirm with counsel)

| Library | License | SaaS / closed-source implication | Decision |
|---|---|---|---|
| PyMuPDF / MuPDF | AGPL-3.0 or Artifex commercial | AGPL §13: users interacting over a network must be offered the Corresponding Source of the whole combined work. Linking into our API process would put the API under AGPL. | NOT USED. If ever needed (rendering, redaction), buy Artifex commercial license or run in a separate process behind `RenderEngine` interface with source published for that component. |
| pikepdf | MPL-2.0 | File-level copyleft only for modifications to pikepdf files. Fine for SaaS. | CORE |
| qpdf (libqpdf, bundled in pikepdf wheels) | Apache-2.0 | Permissive; keep NOTICE. | CORE |
| pypdf | BSD-3-Clause | Permissive. | CORE (text extraction, verification) |
| reportlab | BSD | Permissive. | test fixtures; future generation |
| pyHanko | MIT | Permissive. | planned: signatures |
| OCRmyPDF | MPL-2.0 | File-level copyleft; invoke as CLI/library. Depends on Tesseract (Apache-2.0) and Ghostscript (AGPL-3.0!). | planned; run Ghostscript only as separate subprocess in worker container; legal review of Ghostscript (AGPL/Artifex commercial) required before distribution |
| poppler-utils (pdftotext) | GPL-2/3 | Used as external CLI only in tests. Not shipped in API. | tests only |
| LibreOffice | MPL-2.0 | Separate process in sandboxed conversion worker. | planned |
| FastAPI/Starlette/Pydantic/SQLAlchemy/Alembic/PyJWT/bcrypt | MIT/BSD/Apache | Permissive. | CORE |

Isolation rule: all PDF access goes through `packages/pdf-engine` (`thynkpdf_engine`). Any future AGPL-backed implementation must live in a separate process/package exposing the same functions, so it can be swapped or licensed independently.
No Adobe code, SDKs, fonts or assets are used.
