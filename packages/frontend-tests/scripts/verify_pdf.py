"""Third-party check of a PDF's annotations: qpdf (via pikepdf) structural check + pypdf parse. Prints JSON."""
import json, sys
import pikepdf, pypdf

path = sys.argv[1]
out = {"qpdf_version": pikepdf.__libqpdf_version__, "pypdf_version": pypdf.__version__}
with pikepdf.open(path) as pdf:
    out["qpdf_check_problems"] = [str(p) for p in pdf.check_pdf_syntax()]
    ann = []
    for i, page in enumerate(pdf.pages):
        for a in page.get("/Annots", []):
            ann.append({"page": i, "subtype": str(a.get("/Subtype")), "author": str(a.get("/T", "")), "nm": str(a.get("/NM", "")),
                        "has_ap": "/AP" in a, "irt": "/IRT" in a, "state": str(a.get("/State", "")), "m": str(a.get("/M", ""))})
    out["qpdf_annots"] = ann
r = pypdf.PdfReader(path)
out["pypdf_annots"] = [str(a.get_object()["/Subtype"]) for p in r.pages for a in (p.get("/Annots") or [])]
print(json.dumps(out))
