"""Feature routers. Imported statically (not via pkgutil discovery) so frozen PyInstaller builds bundle every module (BD-01)."""
from . import ai, annotations, audit, docmgmt, forms, pages, redact, signing

MODULES = [ai, annotations, audit, docmgmt, forms, pages, redact, signing]  # sorted by name, same order as the old discovery


def register_all(app, ctx):
    for m in MODULES:
        m.register(app, ctx)
