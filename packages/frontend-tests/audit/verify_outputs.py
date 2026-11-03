"""Independently verify server outputs: download every version of every doc for the dev user and check with pypdf/pikepdf/pdftotext."""
import json, os, subprocess, sys, urllib.request
API=os.environ.get("THYNKPDF_API_URL","http://localhost:8123"); OUT=sys.argv[1] if len(sys.argv)>1 else "/tmp/verify"
os.makedirs(OUT,exist_ok=True)
def req(path, data=None, tok=None, raw=False):
    h={"Content-Type":"application/json"}; 
    if tok: h["Authorization"]="Bearer "+tok
    r=urllib.request.urlopen(urllib.request.Request(API+path, json.dumps(data).encode() if data else None, h))
    return r.read() if raw else json.load(r)
tok=req("/auth/login",{"email":os.environ.get("E","dev@thynkpdf.dev"),"password":os.environ.get("P","ThynkDev-2026!")})["access_token"]
import pypdf, pikepdf
docs=req("/documents?limit=100",tok=tok); items=docs.get("items",docs) if isinstance(docs,dict) else docs
res=[]
for d in items:
    vs=req(f"/documents/{d['document_id']}/versions",tok=tok); vs=vs.get("items",vs) if isinstance(vs,dict) else vs
    for v in vs:
        b=req(f"/documents/{d['document_id']}/versions/{v['version_id']}/file",tok=tok,raw=True)
        fn=f"{OUT}/{d['filename']}.v{v.get('number',v.get('version'))}.pdf"; open(fn,"wb").write(b)
        r=pypdf.PdfReader(fn); 
        try: import io; pikepdf.open(fn).save(io.BytesIO()); pk="ok"
        except Exception as e: pk=str(e)[:80]
        txt=subprocess.run(["pdftotext","-l","1",fn,"-"],capture_output=True,text=True).stdout.strip().replace("\n"," | ")[:160]
        res.append({"file":os.path.basename(fn),"bytes":len(b),"pages":len(r.pages),"rot":[p.get("/Rotate",0) for p in r.pages][:6],"op":v.get("operation") or v.get("op"),"pikepdf":pk,"text_p1":txt,
                    "fields":{k:str(f.get("/V")) for k,f in (r.get_fields() or {}).items()} if r.get_fields() else None})
print(json.dumps(res,indent=1))
