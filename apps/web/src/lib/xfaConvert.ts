import { ApiError } from "@thynkpdf/editor-client";
import { http, runVersionedOp } from "./documents";

/** Feature flag learned at runtime: once the server says the endpoint doesn't exist, hide the action for this session. */
export const xfaConvertSupport = { available: true };
export const XFA_DYNAMIC_UNSUPPORTED_MSG = "The server can't convert this form: it is a dynamic XFA form with no standard (AcroForm) fields to convert. You can still fill it here and save a copy — values are written into the XFA data.";

export type ConvertOutcome = "converted" | "unavailable" | "unsupported" | "failed";
/** Interprets a convert error: 404/405 → endpoint not deployed; 422 xfa_dynamic_unsupported → honest message. */
export function classifyConvertError(e: unknown): Exclude<ConvertOutcome, "converted"> {
  if (e instanceof ApiError) {
    if (e.status === 404 || e.status === 405) return "unavailable";
    if (e.status === 422 && e.code.toLowerCase() === "xfa_dynamic_unsupported") return "unsupported";
  }
  return "failed";
}
export async function convertXfaToStandardForm(): Promise<ConvertOutcome> {
  let outcome: ConvertOutcome = "converted";
  const ok = await runVersionedOp("Convert to standard form", async (ref) => {
    try { return await http().convertXfaToAcroForm(ref); }
    catch (e) { outcome = classifyConvertError(e); if (outcome === "unavailable") xfaConvertSupport.available = false; throw e; }
  });
  return ok ? "converted" : outcome;
}
