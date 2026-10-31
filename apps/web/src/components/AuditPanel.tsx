"use client";
import { useEffect, useState } from "react";
import type { AuditEntry, VerifyOut } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { describeError, http } from "@/lib/documents";

const utc = (s: string) => new Date(s + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));

/** Document audit trail (GET /documents/{id}/audit) plus digital-signature verification of the open version. */
export function AuditPanel() {
  const ref = useSession((s) => s.ref);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [sig, setSig] = useState<VerifyOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return;
    setRows(null); setErr(null);
    http().documentAudit(ref.document_id, 100).then(setRows, (e) => setErr(describeError(e)));
    http().verifySignatures(ref.document_id, ref.version).then(setSig, () => setSig(null));
  }, [ref]);
  return (
    <div className="mt-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="audit-panel">
      <p className="font-semibold">Audit trail</p>
      {err && <p role="alert" className="text-red-600">{err}</p>}
      {!rows && !err && <p>Loading…</p>}
      {rows && (
        <ol className="mt-1 max-h-48 space-y-1 overflow-auto" aria-label="Audit events">
          {rows.map((r, i) => (
            <li key={i} data-testid="audit-row"><b>{r.action}</b>{r.version ? ` v${r.version}` : ""} · {r.actor_email ?? "system"} · <time dateTime={r.at}>{utc(r.at).toLocaleString()}</time></li>))}
          {rows.length === 0 && <li className="text-neutral-500">No events.</li>}
        </ol>)}
      {sig && sig.signatures.length > 0 && (
        <div className="mt-2" data-testid="sig-verify">
          <p className="font-semibold">Digital signatures in this version</p>
          {sig.signatures.map((x) => (
            <p key={x.field}>{x.field}: {x.intact && x.crypto_valid ? "intact" : "INVALID"}{x.modified_after_signing ? ", modified after signing" : ""} · {x.trusted ? "trusted" : "untrusted certificate (dev)"}</p>))}
        </div>)}
    </div>
  );
}
