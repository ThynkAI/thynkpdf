"use client";
import { useEffect, useState } from "react";
import { listSigs, saveSig, deleteSig, type SavedSig } from "@/lib/sigStore";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSignature, dataUrlToBytes } from "@/lib/signature";
import { useSession } from "@/lib/session";
import { SignatureDialog } from "./SignatureDialog";
import { currentBytes, saveModifiedCopy, lastDownload } from "@/lib/copies";
import { pageInfo, stampImage } from "@/lib/pdfWrite";
import { uprightImagePlacement } from "@/lib/geometry";
import { describeError } from "@/lib/documents";

const BLOCKED = "Needs backend support (apps/web/docs/frontend-backend-requests.md §4).";
export function SignPanel() {
  const { image, placement, set } = useSignature();
  const { currentPage, pageSizes } = useViewerStore();
  const s = useSession();
  const [dialog, setDialog] = useState(false);
  const [dl, setDl] = useState<{ url: string; name: string } | null>(null);
  const [saved, setSaved] = useState<SavedSig[]>([]);
  const reloadSaved = () => listSigs().then(setSaved, () => setSaved([]));
  useEffect(() => { void reloadSaved(); }, []);
  const prevImage = useSignature((x) => x.image);
  useEffect(() => {
    // persist newly created signatures (dedupe by data URL)
    if (prevImage && !saved.some((v) => v.dataUrl === prevImage.dataUrl)) void saveSig(prevImage).then(reloadSaved);
  }, [prevImage]); // eslint-disable-line react-hooks/exhaustive-deps
  const has = pageSizes.length > 0;
  const place = () => {
    if (!image) return;
    const sz = pageSizes[currentPage]; const w = Math.min(180, sz.width * 0.35);
    set({ placement: { page: currentPage, left: sz.width / 2 - w / 2, top: sz.height * 0.7, width: w, height: w / image.aspect } });
    setTimeout(() => { const el = document.querySelector<HTMLElement>('[data-testid="sig-box"]'); el?.scrollIntoView({ block: "center" }); el?.focus(); }, 50);
  };
  const apply = async () => {
    if (!image || !placement) return;
    try {
      const bytes = await currentBytes();
      const info = await pageInfo(bytes, placement.page);
      const rect = uprightImagePlacement(placement.left, placement.top, placement.width, placement.height,
        { width: info.width, height: info.height, rotation: info.rotation, x0: info.origin.x, y0: info.origin.y }, 1);
      const out = await stampImage(bytes, placement.page, rect, dataUrlToBytes(image.dataUrl), image.mime);
      const r = await saveModifiedCopy(out, "signed");
      if (r) { set({ placement: null }); setDl(r.kind === "local" && lastDownload.url ? { url: lastDownload.url, name: lastDownload.name! } : null); }
    } catch (e) { s.set({ error: `Signing failed: ${describeError(e)}` }); }
  };
  return (
    <section aria-labelledby="sign-h">
      <h2 id="sign-h" className="mb-1 font-semibold">Sign</h2>
      <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-400" data-testid="sig-disclaimer">Visual e-signature only — not a cryptographic digital signature.</p>
      <div className="flex flex-wrap gap-1 text-xs">
        <button className="rounded border px-2 py-1 dark:border-neutral-700" onClick={() => setDialog(true)}>{image ? "Change signature" : "Create signature"}</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40 dark:border-neutral-700" disabled={!image || !has} onClick={place}>Place on page {currentPage + 1}</button>
        <button className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-40" disabled={!placement || !!s.busy} onClick={apply}>Apply signature</button>
        {placement && <button className="underline" onClick={() => set({ placement: null })}>Cancel</button>}
      </div>
      {image && <img src={image.dataUrl} alt="Your signature preview" className="mt-2 h-10 rounded border bg-white p-1" />}
      {saved.length > 0 && (
        <div className="mt-2" data-testid="saved-sigs">
          <p className="text-[11px] text-neutral-500">Saved in this browser:</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {saved.map((v, i) => (
              <li key={v.id} className="flex items-center gap-1 rounded border p-1 dark:border-neutral-700">
                <button onClick={() => set({ image: { dataUrl: v.dataUrl, mime: v.mime, aspect: v.aspect } })} aria-label={`Use saved signature ${i + 1}`} className={image?.dataUrl === v.dataUrl ? "ring-2 ring-brand-500" : ""}>
                  <img src={v.dataUrl} alt="" className="h-6 bg-white" />
                </button>
                <button className="text-xs" aria-label={`Delete saved signature ${i + 1}`} onClick={() => deleteSig(v.id).then(reloadSaved)}>✕</button>
              </li>))}
          </ul>
        </div>)}
      <p className="mt-1 text-[11px] text-neutral-500">{s.ref ? "Saved as a new document on the server (versioned signing needs backend support)." : "Local file: a signed copy opens here and can be downloaded."}</p>
      {dl && <a className="text-xs underline" href={dl.url} download={dl.name} data-testid="download-signed">Download {dl.name}</a>}
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        <button disabled title={BLOCKED} className="rounded border px-2 py-1 opacity-40" aria-label="Request signatures (unavailable: backend support missing)">Request signatures</button>
        <button disabled title={BLOCKED} className="rounded border px-2 py-1 opacity-40" aria-label="Audit trail (unavailable: backend support missing)">Audit trail</button>
      </div>
      {dialog && <SignatureDialog onClose={() => setDialog(false)} />}
    </section>
  );
}
