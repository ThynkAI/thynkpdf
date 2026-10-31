#!/usr/bin/env bash
# Generates nothing; verifies upgrade/downgrade round trip on a throwaway SQLite DB.
set -euo pipefail; cd "$(dirname "$0")/.."; f=$(mktemp -u /tmp/mig-XXXX.db)
THYNKPDF_DATABASE_URL=sqlite:///$f alembic upgrade head
THYNKPDF_DATABASE_URL=sqlite:///$f alembic downgrade base
THYNKPDF_DATABASE_URL=sqlite:///$f alembic upgrade head
THYNKPDF_DATABASE_URL=sqlite:///$f alembic check && echo MIGRATION_ROUNDTRIP_OK; rm -f "$f"
