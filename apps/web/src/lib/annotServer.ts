/**
 * Mapping between the editor's annotation model and the server annotation API (GET /pdf/{id}/annotations,
 * POST /pdf/annotations). Pure functions; unit-tested.
 */
import type { Annotation, AnnotationIn } from "@thynkpdf/editor-client";
import { isWinAnsi, type NewAnnot, type ParsedAnnot, type Thread, type R } from "./annotWrite";

const rectArr = (r: R) => [r.x, r.y, r.x + r.width, r.y + r.height];
/** Editor stamp labels → the server's standard stamp names. */
export const STAMP_NAME: Record<string, string> = { APPROVED: "Approved", REVIEWED: "ForComment", DRAFT: "Draft", CONFIDENTIAL: "Confidential", FINAL: "Final", REJECTED: "NotApproved" };
const SUBTYPE: Record<string, string> = { highlight: "Highlight", underline: "Underline", strikeout: "StrikeOut", ink: "Ink", text: "Text", freetext: "FreeText", square: "Square", circle: "Circle", line: "Line", arrow: "Line", stamp: "Stamp" };

/**
 * Whether an annotation can be written by the server as-is. The server writes WinAnsi text with Helvetica,
 * has no callout type, and does not counter-rotate text appearances on rotated pages — those cases are written
 * in the browser (Noto Sans / rotated /Matrix) and saved as a new version instead (backend requests R2.4/R2.5).
 */
export function serverCanWrite(a: NewAnnot, pageRotation: number): boolean {
  if (a.type === "callout") return false;
  const texts = [a.contents ?? "", a.author, "text" in a ? a.text : "", "label" in a ? a.label : ""];
  if (!texts.every(isWinAnsi)) return false;
  if ((a.type === "freetext" || a.type === "stamp") && ((pageRotation % 360) + 360) % 360 !== 0) return false;
  return true;
}

export function toServer(a: NewAnnot): AnnotationIn {
  const base = { page: a.page + 1, color: [...a.color], author: a.author, ...(a.contents ? { contents: a.contents } : {}) } as Record<string, unknown>;
  switch (a.type) {
    case "highlight": case "underline": case "strikeout": {
      const qp = a.quads.flatMap((q) => [q.x, q.y + q.height, q.x + q.width, q.y + q.height, q.x, q.y, q.x + q.width, q.y]);
      const xs = a.quads.flatMap((q) => [q.x, q.x + q.width]), ys = a.quads.flatMap((q) => [q.y, q.y + q.height]);
      return { ...base, type: a.type, quad_points: qp, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] } as AnnotationIn;
    }
    case "ink": {
      const pts = a.paths.flat(); const w = a.width ?? 2;
      return { ...base, type: "ink", ink_list: a.paths, border_width: w, rect: [Math.min(...pts.map((p) => p[0])) - w, Math.min(...pts.map((p) => p[1])) - w, Math.max(...pts.map((p) => p[0])) + w, Math.max(...pts.map((p) => p[1])) + w] } as AnnotationIn;
    }
    case "note": return { ...base, type: "text", contents: a.contents ?? "Note", rect: [a.at[0], a.at[1] - 20, a.at[0] + 20, a.at[1]] } as AnnotationIn;
    case "freetext": return { ...base, type: "freetext", contents: a.text, font_size: a.fontSize ?? 11, rect: rectArr(a.rect) } as AnnotationIn;
    case "square": case "circle": return { ...base, type: a.type, border_width: a.width ?? 2, rect: rectArr(a.rect) } as AnnotationIn;
    case "line": case "arrow": {
      const w = a.width ?? 2, pad = 8 + w;
      return { ...base, type: a.type, line: [...a.from, ...a.to], border_width: w,
        rect: [Math.min(a.from[0], a.to[0]) - pad, Math.min(a.from[1], a.to[1]) - pad, Math.max(a.from[0], a.to[0]) + pad, Math.max(a.from[1], a.to[1]) + pad] } as AnnotationIn;
    }
    case "stamp": return { ...base, type: "stamp", stamp_name: STAMP_NAME[a.label] ?? "Draft", contents: a.contents ?? a.label, rect: rectArr(a.rect) } as AnnotationIn;
    default: throw new Error(`Unsupported annotation type ${(a as { type: string }).type}`);
  }
}

const date = (s?: string | null) => (s ? new Date(s) : null);
export function fromServer(list: Annotation[]): ParsedAnnot[] {
  return list.map((x) => {
    const [x0, y0, x1, y1] = x.rect;
    return { id: x.id, page: x.page - 1, subtype: SUBTYPE[x.type] ?? x.type, author: x.author ?? "", contents: x.contents ?? "",
      modified: date(x.modified_at), created: date(x.created_at),
      rect: { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) },
      inReplyTo: x.in_reply_to ?? null, state: x.state ?? undefined, server: true, supported: x.supported };
  });
}
/** Server threads: replies via in_reply_to; resolved is a state on the root (backend's simplified Review model). */
export function serverThreads(all: ParsedAnnot[]): Thread[] {
  return all.filter((a) => !a.inReplyTo && a.supported !== false).map((root) => ({
    root, replies: all.filter((a) => a.inReplyTo === root.id).sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0)),
    resolved: root.state === "resolved", stateAt: root.state === "resolved" ? root.modified : null,
  }));
}
