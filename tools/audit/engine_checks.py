"""Stage-5 engine diagnostics against the repo's thynkpdf_engine at the checked-out commit.
Each check prints PASS/FAIL/INFO with evidence; independent validation via PyMuPDF (MuPDF), pypdf and poppler pdftotext.
Run from repo root:  python tools/audit/make_corpus.py && python tools/audit/engine_checks.py"""
import io, json, subprocess, sys, tempfile, time, os, resource
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
for p in ["apps/api", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai"]: sys.path.insert(0, str(ROOT / p))
import pymupdf, pypdf, pikepdf
import thynkpdf_engine as eng
from thynkpdf_engine import edit as E, forms as F, annots as A
C = Path(__file__).resolve().parent / "corpus"
R = []
def rec(cid, status, msg, **ev): R.append({"id": cid, "status": status, "msg": msg, **ev}); print(f"[{status}] {cid}: {msg} {json.dumps(ev, default=str)[:400]}")
rd = lambda n: (C / n).read_bytes()
def mu(b): return pymupdf.open(stream=b, filetype="pdf")
def ptext(b):
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(b); f.flush(); return subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True).stdout
def words(b, pno=0): return [(round(w[0], 1), round(w[1], 1), w[4]) for w in mu(b)[pno].get_text("words")]
def err(fn):
    try: fn(); return None
    except eng.EngineError as e: return e.code
    except Exception as e: return "EXC:" + type(e).__name__

# ---- text editing
d = rd("std_text.pdf")
out, n = eng.replace_text(d, 1, "Hello", "Howdy"); t = ptext(out)
rec("E1-replace", "PASS" if "Howdy World" in t and "Hello" not in t.split("\f")[0] else "FAIL", "Std-14 replace", count=n, pypdf=pypdf.PdfReader(io.BytesIO(out)).pages[0].extract_text()[:60])
out, n = E.delete_text(d, 1, "Invoice total ", "all")
rec("E2-delete-not-redaction", "INFO", "delete_text removes glyphs from the run; earlier version still stored in history by design (versions immutable)", remaining=ptext(out).split("\n")[1].strip())
b4 = words(d); out, n = E.move_text(d, 1, "Hello", 0, -100); af = words(out)
rec("E3-move", "PASS" if any(w[2] == "Synthetic" and w[1] > b4[0][1] + 90 for w in af) else "FAIL", "move whole run", before=b4[:3], after=af[:3])
# move side-effects on the next operator in the same BT
d2 = rd("two_runs.pdf"); b4 = words(d2); out, _ = E.move_text(d2, 1, "Alpha", 0, 50); af = words(out)
beta_b4 = [w for w in b4 if w[2] == "Beta"][0]; beta_af = [w for w in af if w[2] == "Beta"][0]
rec("E4-move-side-effect", "FAIL" if abs(beta_b4[0] - beta_af[0]) > 1 or abs(beta_b4[1] - beta_af[1]) > 1 else "PASS",
    "moving 'Alpha' must not move 'Beta' (next Tj in same BT)", beta_before=beta_b4, beta_after=beta_af)
for name, find in [("accented.pdf", "Café"), ("embedded_subset.pdf", "Embedded"), ("cid_cjk.pdf", "日本")]:
    rec(f"E5-replace-{name}", "INFO", "replace on font class", code=err(lambda: eng.replace_text(rd(name), 1, find, "X")))
rec("E6-insert-unicode-latin1", "INFO", "insert 'Zürich é'", code=err(lambda: E.insert_text(d, 1, "Zürich é", 72, 100)) or "OK")
rec("E6-insert-unicode-ext", "INFO", "insert 'Łódź'", code=err(lambda: E.insert_text(d, 1, "Łódź", 72, 100)))
rec("E6-insert-cjk", "INFO", "insert '日本'", code=err(lambda: E.insert_text(d, 1, "日本", 72, 100)))
rec("E6-insert-euro", "INFO", "insert '€ – “”' (cp1252-only glyphs)", code=err(lambda: E.insert_text(d, 1, "€ – “”", 72, 100)) or "OK",
    rendered=(lambda b: mu(b)[0].get_text())(E.insert_text(d, 1, "€ – “”", 72, 100))[-20:] if not err(lambda: E.insert_text(d, 1, "€ – “”", 72, 100)) else None)
# ---- page ops
a = rd("annots_links_bookmarks_attach_js.pdf")
def struct(b):
    p = pikepdf.Pdf.open(io.BytesIO(b)); m = mu(b)
    return {"pages": len(p.pages), "annots": sum(len(pg.obj.get("/Annots", [])) for pg in p.pages), "outline": len(m.get_toc()),
            "attachments": len(p.attachments), "acroform_fields": len(p.Root.AcroForm.Fields) if "/AcroForm" in p.Root else 0,
            "openaction": "/OpenAction" in p.Root}
s0 = struct(a); rec("P0-baseline", "INFO", "rich doc baseline", **s0)
for op, fn in [("rotate", lambda: eng.rotate(a, [1], 90)), ("reorder", lambda: eng.reorder(a, [3, 1, 2])),
               ("extract", lambda: eng.extract(a, [1, 2])), ("merge", lambda: eng.merge([a, rd("std_text.pdf")])),
               ("delete_pages", lambda: E.delete_pages(a, [2])), ("duplicate", lambda: E.duplicate_pages(a, [1])),
               ("insert_blank", lambda: E.insert_blank(a, 1)), ("insert_from", lambda: E.insert_from(a, rd("std_text.pdf"), [1], 1))]:
    s = struct(fn()); rec(f"P-{op}", "INFO", "structure after op", **s)
dup = E.duplicate_pages(a, [1]); s = struct(dup)
rec("P1-duplicate-annots", "FAIL" if s["annots"] < s0["annots"] + 2 else "PASS", "duplicate page keeps its annotations/links", before=s0["annots"], after=s["annots"])
ro = struct(eng.reorder(a, [3, 1, 2])); rec("P2-reorder-bookmarks", "FAIL" if ro["outline"] < 3 or ro["attachments"] < 1 else "PASS", "reorder preserves bookmarks + attachments", **ro)
f = rd("acroform.pdf"); mf = struct(eng.merge([f, rd("std_text.pdf")]))
rec("P3-merge-acroform", "FAIL" if mf["acroform_fields"] == 0 else "PASS", "merge keeps AcroForm fields usable", **mf)
rf = struct(eng.reorder(f + b"", [1])); rec("P3b-reorder-acroform", "FAIL" if rf["acroform_fields"] == 0 else "PASS", "reorder (single page) keeps AcroForm", **rf)
r = rd("rotated.pdf"); out = eng.rotate(r, [2], 90); rec("P4-rotate-relative", "PASS" if mu(out)[1].rotation == 180 else "FAIL", "relative rotate 90 on /Rotate 90 page", rotation=mu(out)[1].rotation)
rec("P5-mixed-geometry-merge", "INFO", "page sizes after merge", sizes=[tuple(round(x) for x in p.rect[2:]) for p in mu(eng.merge([rd("mixed_sizes.pdf"), r]))])
# ---- forms
fl = F.list_fields(f); rec("F1-list", "INFO", "fields", fields=[(x.get("name"), x.get("type")) for x in fl])
out, rep = F.fill_fields(f, {"full_name": "Jane Synthetic", "agree": True, "country": "France"})
vals = {k: str(v.get("/V")) for k, v in pypdf.PdfReader(io.BytesIO(out)).get_fields().items()}
rec("F2-fill", "PASS" if vals.get("full_name") == "Jane Synthetic" and vals.get("country") == "France" else "FAIL", "fill verified by pypdf", values=vals)
fo = F.flatten(out); tt = ptext(fo); rem = pypdf.PdfReader(io.BytesIO(fo)).get_fields()
rec("F3-flatten", "PASS" if "Jane Synthetic" in tt and not rem else "FAIL", "flatten keeps value as page content and removes fields", text_has_value="Jane Synthetic" in tt, remaining_fields=len(rem or {}))
rec("F4-xxe", "INFO", "XFA with external entity", code=err(lambda: eng.xfa.read_data(rd("xfa_xxe.pdf")) if hasattr(eng.xfa, "read_data") else eng.xfa.detect(rd("xfa_xxe.pdf"))))
try:
    det = eng.xfa.detect(rd("xfa_xxe.pdf")); rec("F4b-xxe-detect", "INFO", "detect result", res=str(det)[:200])
except Exception as e: rec("F4b-xxe-detect", "INFO", "detect raised", code=getattr(e, "code", type(e).__name__))
fns = [n for n in dir(eng.xfa) if not n.startswith("_")]; rec("F4c-xfa-api", "INFO", "xfa functions", fns=fns)
# ---- compression
for name in ["image_heavy.pdf", "std_text.pdf", "large_2000p.pdf"]:
    d = rd(name); res = {}
    for pr in ["low", "balanced", "high"]:
        t0 = time.perf_counter(); o, rep = eng.compress(d, pr); res[pr] = (len(o), o == d, round(time.perf_counter() - t0, 2))
    raw = {pr: len(E._save(eng.open_pdf(d), **eng.engine.PRESETS[pr])) for pr in ["low", "balanced", "high"]}
    rec(f"C1-{name}", "INFO", "(final_size, kept_original, seconds) per preset; raw = pre-guard output sizes", original=len(d), **res, raw=raw)
# ---- signatures
from thynkpdf_signatures import generate_dev_cert, Signer, verify
tmp = tempfile.mkdtemp(); cp, kp = generate_dev_cert(tmp); sg = Signer(cp, kp)
signed = sg.sign(rd("std_text.pdf")); v = verify(signed)
rec("S1-sign-verify", "PASS" if v and v[0].get("intact") else "FAIL", "pyHanko sign + verify (self-signed)", result={k: v[0].get(k) for k in ("intact", "valid", "trusted", "coverage") if k in v[0]})
pv = pypdf.PdfReader(io.BytesIO(signed)); rec("S1b-independent", "INFO", "pypdf sees /Sig field", sig_fields=[k for k, x in (pv.get_fields() or {}).items() if x.get("/FT") == "/Sig"])
(C / "signed_selfsigned.pdf").write_bytes(signed)
caps = eng.inspect(signed); rec("S2-detect-signed", "PASS" if caps["has_signatures"] else "FAIL", "inspect flags signatures")
rot = eng.rotate(signed, [1], 90); v2 = verify(rot)
rec("S3-engine-rotate-signed", "INFO", "engine-level rotate on signed doc (API layer blocks via writable(); engine itself rewrites the file)", sigs_after=len(v2), intact=[x.get("intact") for x in v2])
ext = eng.extract(signed, [1]); rec("S4-extract-signed", "INFO", "extract from signed doc (API allow_signed=True): signature dropped in output", sigs_after=len(verify(ext)))
# ---- malformed / limits
for name in ["truncated.pdf", "garbage_after_header.pdf", "no_pages.pdf", "encrypted_userpw.pdf", "encrypted_ownerpw_only.pdf", "scan_image_only.pdf"]:
    rec(f"M-{name}", "INFO", "open_pdf/inspect", code=err(lambda: eng.inspect(rd(name))) or "OK")
caps = eng.capabilities(rd("scan_image_only.pdf")); rec("O1-ocr", "INFO", "scan capabilities (OCR suggested?)", safe_alternatives=caps.get("safe_alternatives"), tesseract=bool(subprocess.run(["sh", "-c", "command -v tesseract"], capture_output=True).stdout))
t0 = time.perf_counter(); r0 = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
code = err(lambda: eng.inspect(rd("flate_bomb_512MiB.pdf"))); c2 = err(lambda: eng.compress(rd("flate_bomb_512MiB.pdf"), "balanced"))
rec("L1-flate-bomb", "INFO", "0.5 MiB file inflating to 512 MiB: inspect + compress", inspect=code or "OK", compress=c2 or "OK", seconds=round(time.perf_counter() - t0, 1),
    maxrss_mib_before=r0 // 1024, maxrss_mib_after=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
t0 = time.perf_counter(); L = rd("large_2000p.pdf"); eng.inspect(L); ti = time.perf_counter() - t0
t0 = time.perf_counter(); eng.merge([L, L]); tm = time.perf_counter() - t0
t0 = time.perf_counter(); eng.capabilities(L); tc = time.perf_counter() - t0
rec("L2-large-timing", "INFO", "2000-page doc", inspect_s=round(ti, 2), merge2x_s=round(tm, 2), capabilities_s=round(tc, 2), maxrss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
json.dump(R, open(Path(__file__).resolve().parent / "engine_results.json", "w"), indent=1, default=str)
print("FAILS:", [r["id"] for r in R if r["status"] == "FAIL"])
