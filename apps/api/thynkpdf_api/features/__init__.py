import importlib, pkgutil

def register_all(app, ctx):
    for m in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        importlib.import_module(f"{__name__}.{m.name}").register(app, ctx)
