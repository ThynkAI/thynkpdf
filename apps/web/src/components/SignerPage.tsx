"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Wordmark } from "@thynkpdf/ui";
import { HttpEditorApi, type SignSession, type SignerPlacement } from "@thynkpdf/editor-client";
import { describeError } from "@/lib/documents";
import { useSignature } from "@/lib/signature";
import { toPngBlob } from "@/lib/png";
import { PdfPages } from "./PdfPages";
import { SignatureDialog } from "./SignatureDialog";

const FONTS = ["Times-Italic", "Helvetica-Oblique", "Courier-Oblique", "Times-BoldItalic"];

/** Account-free signer page for /sign/{token}: consent → fill own fields → POST /sign/{token}/complete (or decline). */
export function SignerPage() {
  const { token } = useParams<{ token: string }>();
  const api = useMemo(() => new HttpEditorApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000" }), []);
  const [sess, setSess] = useState<SignSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [typed, setTyped] = useState(""); const [font, setFont] = useState(FONTS[0]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [draw, setDraw] = useState(false); const [declining, setDeclining] = useState(false); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const image = useSignature((s) => s.image);
  useEffect(() => { api.getSignSession(token).then((s) => { setSess(s); setTyped(s.signer_name); }, (e) => setErr(describeError(e))); }, [api, token]);
  const mine = sess?.fields.filter((f) => f.signer_index === sess.signer_index && !f.completed) ?? [];
  const needsText = mine.filter((f) => f.type === "text");
  const ready = consent && (typed.trim() || image) && needsText.every((f) => (texts[f.field_id] ?? "").trim());

  const submit = async () => {
    if (!sess) return;
    setBusy(true); setErr(null);
    try {
      const png = image ? (await toPngBlob(image.dataUrl)).dataUrl.split(",")[1] : null;
      const placements: SignerPlacement[] = mine.map((f) =>
        f.type === "signature" || f.type === "initials"
          ? (png ? { field_id: f.field_id, image_base64: png } : { field_id: f.field_id, text: f.type === "initials" ? typed.trim().split(/\s+/).map((w) => w[0]).join("") : typed.trim(), font })
          : f.type === "text" ? { field_id: f.field_id, text: texts[f.field_id].trim() } : { field_id: f.field_id });
      const r = await api.completeSigning(token, placements);
      setDone(r.status === "completed" ? "Thank you — all parties have signed. The document owner now has the final signed version." : "Thank you — your signature has been recorded.");
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-3 border-b px-4 dark:border-neutral-800"><Wordmark /><h1 className="text-sm font-semibold">{sess?.title || "Signature request"}</h1></header>
      <main className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[1fr_18rem]">
        <div>{sess && <PdfPages url={api.signDocumentUrl(token)} overlay={(page, map) => sess.fields.filter((f) => f.page === page).map((f) => {
          const [ax, ay] = map(f.rect[0], f.rect[1]); const [bx, by] = map(f.rect[2], f.rect[3]);
          const m = f.signer_index === sess.signer_index;
          return <div key={f.field_id} data-testid="sign-field" title={`${f.type}${m ? " (yours)" : ""}`} className={`absolute border-2 ${m ? "border-brand-600 bg-brand-500/10" : "border-neutral-400 border-dashed"}`}
            style={{ left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }}><span className="text-[10px]">{f.type}</span></div>;
        })} />}</div>
        <aside className="space-y-3 text-sm">
          {err && <p role="alert" className="text-red-600">{err}</p>}
          {!sess && !err && <p>Loading…</p>}
          {done ? <p role="status" className="rounded bg-green-50 p-2 text-green-800 dark:bg-green-950 dark:text-green-200" data-testid="sign-done">{done}</p> : sess && (
            !sess.can_sign ? <p role="status" data-testid="sign-blocked">You can’t sign right now: {sess.blocked_reason ?? sess.status}.</p> : (<>
              <p>Hello <b>{sess.signer_name}</b> ({sess.signer_email}).</p>
              {sess.message && <p className="whitespace-pre-wrap rounded bg-neutral-100 p-2 dark:bg-neutral-800">{sess.message}</p>}
              <p className="text-xs text-neutral-500">You have {mine.length} field{mine.length === 1 ? "" : "s"} to complete (outlined in blue). Date fields fill in automatically.</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">This is an electronic signature recorded with an audit trail. THYNKPDF makes no claim about legal enforceability.</p>
              <fieldset className="space-y-1">
                <legend className="font-semibold">Your signature</legend>
                <input aria-label="Type your signature" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!!image} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
                <select aria-label="Signature style" value={font} onChange={(e) => setFont(e.target.value)} disabled={!!image} className="rounded border dark:bg-neutral-800">{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
                <div className="flex items-center gap-2 text-xs">
                  <button type="button" className="underline" onClick={() => setDraw(true)}>{image ? "Change drawn signature" : "Draw or upload instead"}</button>
                  {image && <><img src={image.dataUrl} alt="Your drawn signature" className="h-8 bg-white" /><button className="underline" onClick={() => useSignature.getState().set({ image: null })}>Use typed</button></>}
                </div>
              </fieldset>
              {needsText.map((f, i) => <input key={f.field_id} aria-label={`Text field ${i + 1}`} placeholder={`Text field ${i + 1}`} value={texts[f.field_id] ?? ""} onChange={(e) => setTexts({ ...texts, [f.field_id]: e.target.value })} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />)}
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span data-testid="consent-text">{sess.consent_text}</span></label>
              <button className="w-full rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-40" disabled={!ready || busy} onClick={submit}>{busy ? "Signing…" : "Sign document"}</button>
              {!declining ? <button className="text-xs underline" onClick={() => setDeclining(true)}>Decline to sign</button> : (
                <form className="space-y-1" onSubmit={async (e) => { e.preventDefault(); try { await api.declineSigning(token, reason); setDone("You declined to sign. Your decision is recorded in the request history."); } catch (x) { setErr(describeError(x)); } }}>
                  <textarea aria-label="Reason for declining" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border px-1 dark:bg-neutral-800" />
                  <button className="rounded border border-red-400 px-2 py-1 text-xs text-red-700">Confirm decline</button>
                </form>)}
            </>))}
        </aside>
      </main>
      {draw && <SignatureDialog onClose={() => setDraw(false)} />}
    </div>
  );
}
