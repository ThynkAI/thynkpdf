"use client";
import { useEffect, useRef, useState } from "react";
import { useSignature, typedSignature } from "@/lib/signature";
import { toPngBlob } from "@/lib/png";

type Tab = "draw" | "type" | "upload";
export function SignatureDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<Tab>("draw");
  const [typed, setTyped] = useState(""); const [style, setStyle] = useState<"cursive" | "serif-italic">("cursive");
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const set = useSignature((s) => s.set);

  useEffect(() => {
    const c = canvas.current; if (!c || tab !== "draw") return;
    const ctx = c.getContext("2d")!; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#111827";
    let down = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)] as const; };
    const start = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); drawn.current = true; };
    const end = () => { down = false; };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move); c.addEventListener("pointerup", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", end); };
  }, [tab]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const accept = async () => {
    setErr(null);
    if (tab === "draw") {
      if (!drawn.current) return setErr("Draw your signature first.");
      const c = canvas.current!; set({ image: { dataUrl: c.toDataURL("image/png"), mime: "image/png", aspect: c.width / c.height } });
    } else if (tab === "type") {
      if (!typed.trim()) return setErr("Type your name first.");
      const t = typedSignature(typed.trim(), style); set({ image: { ...t, mime: "image/png" } });
    }
    onClose();
  };
  const onUpload = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(f.type)) return setErr("Use a PNG, JPEG or SVG image.");
    if (f.size > 1_000_000) return setErr("Image must be under 1 MB.");
    const r = new FileReader();
    // Always store as PNG: SVG is rasterized (the server rejects SVG), JPEG is converted so the server accepts it.
    r.onload = () => { toPngBlob(String(r.result)).then((p) => { set({ image: { dataUrl: p.dataUrl, mime: "image/png", aspect: p.aspect } }); onClose(); }, (e) => setErr((e as Error).message)); };
    r.readAsDataURL(f);
  };
  const tabBtn = (t: Tab, l: string) => <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? "bg-brand-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>{l}</button>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="sig-h" className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900">
        <h2 id="sig-h" className="font-semibold">Create signature</h2>
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Visual e-signature: an image placed on the page. It is <b>not</b> a cryptographic digital signature and does not prove identity or detect tampering.</p>
        <div role="tablist" className="mb-2 flex gap-1">{tabBtn("draw", "Draw")}{tabBtn("type", "Type")}{tabBtn("upload", "Upload")}</div>
        {tab === "draw" && <canvas ref={canvas} width={600} height={200} aria-label="Signature drawing area" data-testid="sig-canvas" className="h-[150px] w-full touch-none rounded border bg-white" />}
        {tab === "type" && (
          <div className="space-y-2">
            <input aria-label="Type your name" value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
            <div className="flex gap-3 text-sm">
              <label><input type="radio" checked={style === "cursive"} onChange={() => setStyle("cursive")} /> <span style={{ fontFamily: "cursive" }}>Script</span></label>
              <label><input type="radio" checked={style === "serif-italic"} onChange={() => setStyle("serif-italic")} /> <span className="italic" style={{ fontFamily: "Georgia, serif" }}>Serif italic</span></label>
            </div>
          </div>)}
        {tab === "upload" && <input type="file" accept="image/png,image/jpeg,image/svg+xml" aria-label="Upload signature image" onChange={(e) => onUpload(e.target.files?.[0])} />}
        {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          {tab === "draw" && <button className="mr-auto text-sm underline" onClick={() => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; }}>Clear</button>}
          <button className="rounded px-3 py-1 text-sm" onClick={onClose}>Cancel</button>
          {tab !== "upload" && <button className="rounded bg-brand-600 px-3 py-1 text-sm text-white" onClick={accept}>Use signature</button>}
        </div>
      </div>
    </div>
  );
}
