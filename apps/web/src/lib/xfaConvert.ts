import { ApiError, XFA_ERROR_MESSAGES, type VersionResult } from "@thynkpdf/editor-client";
import { http, runVersionedOp } from "./documents";
import { useSession } from "./session";

/** Feature flag learned at runtime: once the server says an endpoint doesn't exist, hide its action for this session. */
export const xfaConvertSupport = { available: true };
export const XFA_DYNAMIC_UNSUPPORTED_MSG = XFA_ERROR_MESSAGES.xfa_dynamic_unsupported;

export type XfaOutcome = "ok" | "unavailable" | "known" | "failed";
/** 404/405 without a document error code → endpoint not deployed (DOCUMENT_NOT_FOUND is a real error). */
export function classifyXfaError(e: unknown): { outcome: Exclude<XfaOutcome, "ok">; message?: string } {
  if (e instanceof ApiError) {
    if ((e.status === 404 && !/DOCUMENT_NOT_FOUND|VERSION_NOT_FOUND/.test(e.code)) || e.status === 405) return { outcome: "unavailable" };
    const key = e.code === "XFA_DYNAMIC_UNSUPPORTED" ? "xfa_dynamic_unsupported" : e.code;
    if (XFA_ERROR_MESSAGES[key]) {
      const unsupported = (e.details?.unsupported as string[] | string | undefined);
      return { outcome: "known", message: XFA_ERROR_MESSAGES[key] + (key === "xfa_dynamic_unsupported" && unsupported ? ` (Server: ${Array.isArray(unsupported) ? unsupported.join(", ") : unsupported})` : "") };
    }
  }
  return { outcome: "failed" };
}
/** Back-compat name used by tests/components. */
export function classifyConvertError(e: unknown): "unavailable" | "unsupported" | "failed" {
  const c = classifyXfaError(e);
  if (c.outcome === "unavailable") return "unavailable";
  if (e instanceof ApiError && /^xfa_dynamic_unsupported$/i.test(e.code)) return "unsupported";
  return "failed";
}

/** Run a versioned XFA op; replaces runPageOp's generic error with an honest XFA message. VERSION_CONFLICT is handled by runPageOp (reload). */
export async function runXfaOp(label: string, fn: Parameters<typeof runVersionedOp>[1]): Promise<{ outcome: XfaOutcome; message?: string; report?: Record<string, unknown> | null }> {
  let err: unknown = null; let report: Record<string, unknown> | null = null;
  const ok = await runVersionedOp(label, async (r) => { try { const v: VersionResult = await fn(r); report = (v.report as Record<string, unknown>) ?? null; return v; } catch (e) { err = e; throw e; } });
  if (ok) return { outcome: "ok", report };
  if (!err) return { outcome: "failed" };
  const c = classifyXfaError(err);
  if (c.outcome !== "failed" && !(err instanceof ApiError && err.code === "VERSION_CONFLICT")) useSession.getState().set({ error: null });
  return c;
}

export async function convertXfaToStandardForm() {
  const r = await runXfaOp("Convert to standard form", (ref) => http().convertXfaToAcroForm(ref));
  if (r.outcome === "unavailable") xfaConvertSupport.available = false;
  return r;
}
export function describeConvertReport(report?: Record<string, unknown> | null): string {
  const mode = report?.mode;
  if (mode === "stripped_xfa") return "Converted: XFA removed, the existing standard fields were kept (new version; earlier versions keep the XFA).";
  if (mode === "rendered_from_template") {
    const w = (report?.warnings as string[] | undefined) ?? [];
    return `Converted: the server generated ${report?.pages ?? "new"} page(s) with ${Array.isArray(report?.fields) ? (report!.fields as unknown[]).length : report?.fields ?? "the"} standard fields from the XFA template. Layout is simplified (top-down, no backgrounds/graphics)${w.length ? `; warnings: ${w.join("; ")}` : ""}.`;
  }
  return "Converted to a standard form (new version).";
}
