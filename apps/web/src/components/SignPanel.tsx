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
import { describeError, http, runVersionedOp } from "@/lib/documents";
import { displayBoxToPdfRect } from "@/lib/geometry";
import { toPngBlob } from "@/lib/png";
import { RequestSignatures } from "./RequestSignatures";
import { AuditPanel } from "./AuditPanel";

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
  const [more, setMore] = useState<"request" | "audit" | null>(null);
  const server = !!s.ref && s.api.kind === "http";
  const apply = async () => {
    if (!image || !placement) return;
    if (server && (await pageInfo(await currentBytes(), placement.page)).rotation % 360 === 0) {
      // Versioned server path: PNG asset upload + POST /pdf/signatures/place (expected_version). Visual only (report.visual_only).
      try {
        const bytes = await currentBytes();
        const info = await pageInfo(bytes, placement.page);
        const r = displayBoxToPdfRect(placement.left, placement.top, placement.width, placement.height,
          { width: info.width, height: info.height, rotation: info.rotation, x0: info.origin.x, y0: info.origin.y }, 1);
        const png = await toPngBlob(image.dataUrl);
        const asset = await http().uploadSignaturePng(png.blob);
        const ok = await runVersionedOp("Place signature", (ref) => http().placeSignatures(ref, [{ asset_id: asset.asset_id, page: placement.page + 1, rect: [r.x, r.y, r.x + r.width, r.y + r.height] }]));
        if (ok) { set({ placement: null }); s.set({ notice: `Signature placed — saved as version ${useSession.getState().ref?.version}.` }); }
      } catch (e) { s.set({ error: `Signing failed: ${describeError(e)}` }); }
      return;
    }
    // Local files, and rotated server pages (the server's stamp does not counter-rotate yet — backend request R4.5):
    // stamp upright in the browser, then save (server docs → new version via POST /documents/{id}/versions).
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
      <p className="mt-1 text-[11px] text-neutral-500">{server ? "Server document: the signature is stamped by the server and saved as a new version (visual only)." : "Local file: a signed copy opens here and can be downloaded."}</p>
      {dl && <a className="text-xs underline" href={dl.url} download={dl.name} data-testid="download-signed">Download {dl.name}</a>}
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        <button className="rounded border px-2 py-1 disabled:opacity-40 dark:border-neutral-700" disabled={!server} title={server ? undefined : "Requires a document opened through the THYNKPDF server"} aria-expanded={more === "request"} onClick={() => setMore(more === "request" ? null : "request")}>Request signatures</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40 dark:border-neutral-700" disabled={!server} title={server ? undefined : "Requires a document opened through the THYNKPDF server"} aria-expanded={more === "audit"} onClick={() => setMore(more === "audit" ? null : "audit")}>Audit trail</button>
      </div>
      {server && more === "request" && <RequestSignatures />}
      {server && more === "audit" && <AuditPanel />}
      {dialog && <SignatureDialog onClose={() => setDialog(false)} />}
    </section>
  );
}
