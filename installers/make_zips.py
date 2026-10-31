"""Build THYNKPDF-Windows.zip / THYNKPDF-Mac.zip (keeps +x on .command files). Usage: python make_zips.py [outdir]"""
import os, sys, zipfile
here = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "dist")
os.makedirs(out, exist_ok=True)
def mk(name, files):
    with zipfile.ZipFile(os.path.join(out, name), "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            zi = zipfile.ZipInfo.from_file(os.path.join(here, f), "THYNKPDF-installer/" + f); zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = (0o100755 if f.endswith(".command") else 0o100644) << 16
            z.writestr(zi, open(os.path.join(here, f), "rb").read())
    print(os.path.join(out, name))
mk("THYNKPDF-Windows.zip", ["install-windows.bat", "install-windows.ps1", "start-windows.bat", "README.md"])
mk("THYNKPDF-Mac.zip", ["install-mac.command", "start-mac.command", "README.md"])
