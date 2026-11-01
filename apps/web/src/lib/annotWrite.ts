/**
 * Real PDF annotations written with pdf-lib (MIT). Every annotation gets /NM (id), /T (author), /M + /CreationDate,
 * /Contents and an appearance stream (/AP /N) so any reader (PDF.js, qpdf-based tools, Acrobat) shows it.
 * Replies are /Text annots with /IRT + /RT /R; resolve/reopen are Review state annots (/StateModel /Review, /State Completed|None).
 */
import { savePdf } from "./pdfWrite";
import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, PDFRef, PDFNumber, StandardFonts, PDFHexString, PDFFont,
  pushGraphicsState, popGraphicsState, setFillingRgbColor, setStrokingRgbColor, setLineWidth, rectangle, fill, stroke,
  moveTo, lineTo, appendBezierCurve, closePath, beginText, endText, setFontAndSize, showText, moveText, setGraphicsState, fillAndStroke, type PDFOperator } from "pdf-lib";

export type RGB = [number, number, number];
export interface R { x: number; y: number; width: number; height: number }
interface Base { page: number; author: string; color: RGB; contents?: string; date?: Date; id?: string }
export type NewAnnot = Base & (
  | { type: "highlight" | "underline" | "strikeout"; quads: R[] }
  | { type: "ink"; paths: [number, number][][]; width?: number }
  | { type: "note"; at: [number, number] }
  | { type: "freetext"; rect: R; text: string; fontSize?: number }
  | { type: "callout"; rect: R; anchor: [number, number]; text: string; fontSize?: number }
  | { type: "square" | "circle"; rect: R; width?: number }
  | { type: "line" | "arrow"; from: [number, number]; to: [number, number]; width?: number }
  | { type: "stamp"; rect: R; label: string });

export function pdfDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
export function parsePdfDate(s: string | undefined): Date | null {
  const m = s && /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  const tz = !m[7] || m[7] === "Z" ? "Z" : m[7].replace(/'/g, "").replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(iso + tz);
}
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const txt = (s: string) => PDFHexString.fromText(s);

function bounds(pts: [number, number][], pad = 0): R {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}
const arr = (doc: PDFDocument, nums: number[]) => doc.context.obj(nums);

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
/** True when Helvetica (WinAnsi) can encode the text; otherwise a Unicode font is embedded. */
export function isWinAnsi(t: string) { for (const ch of t) { const c = ch.codePointAt(0)!; if (!((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || c === 10 || c === 13 || c === 9 || CP1252_EXTRA.includes(ch))) return false; } return true; }
/** Loads Noto Sans Regular (SIL OFL 1.1, apps/web/public/fonts). Overridable for tests. */
export const unicodeFont: { load: () => Promise<Uint8Array> } = {
  load: async () => new Uint8Array(await (await fetch("/fonts/NotoSans-Regular.ttf")).arrayBuffer()),
};
async function getFont(doc: PDFDocument, texts: string[] = []) {
  if (texts.every(isWinAnsi)) return doc.embedFont(StandardFonts.Helvetica);
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  doc.registerFontkit(fontkit);
  return doc.embedFont(await unicodeFont.load(), { subset: true });
}
/** Form-XObject matrix that rotates appearance content CCW by the page /Rotate so it reads upright on screen. */
export function rotMatrix(rot: number): number[] {
  switch (((rot % 360) + 360) % 360) { case 90: return [0, 1, -1, 0, 0, 0]; case 180: return [-1, 0, 0, -1, 0, 0]; case 270: return [0, -1, 1, 0, 0, 0]; default: return [1, 0, 0, 1, 0, 0]; }
}

function appearance(doc: PDFDocument, bbox: R, ops: PDFOperator[], resources: Record<string, unknown> = {}, matrix?: number[]) {
  const stream = doc.context.formXObject(ops, { BBox: [bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height], Resources: resources as never, ...(matrix ? { Matrix: matrix } : {}) });
  return doc.context.register(stream);
}

function textOps(font: PDFFont, fontName: string, lines: string[], size: number, x: number, yTop: number): PDFOperator[] {
  const ops: PDFOperator[] = [beginText(), setFontAndSize(fontName, size), setFillingRgbColor(0.07, 0.07, 0.1)];
  let y = yTop - size;
  ops.push(moveText(x, y));
  lines.forEach((l, i) => { if (i) ops.push(moveText(0, -size * 1.2)); ops.push(showText(font.encodeText(l))); y -= size * 1.2; });
  ops.push(endText());
  return ops;
}

/** Add annotations; returns new bytes and the ids assigned (in input order). */
export async function addAnnotations(bytes: Uint8Array, list: NewAnnot[]): Promise<{ bytes: Uint8Array; ids: string[] }> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const font = await getFont(doc, list.flatMap((a) => [("text" in a ? a.text : "") ?? "", "label" in a ? a.label : ""]));
  const gsAlpha = ctx.register(ctx.obj({ Type: "ExtGState", CA: 0.45, ca: 0.45, BM: "Multiply" }));
  const ids: string[] = [];
  for (const a of list) {
    const page = doc.getPage(a.page);
    const id = a.id ?? newId(); ids.push(id);
    const now = pdfDate(a.date ?? new Date());
    const [r, g, b] = a.color;
    const dict: Record<string, unknown> = {
      Type: "Annot", NM: PDFString.of(id), T: txt(a.author), M: PDFString.of(now), CreationDate: PDFString.of(now),
      C: [r, g, b], F: 4, P: page.ref, Contents: txt(a.contents ?? ""),
    };
    let rect: R; let ap: PDFRef | null = null; const fontName = "Helv";
    const fontRes = { Font: { [fontName]: font.ref } };
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    switch (a.type) {
      case "highlight": case "underline": case "strikeout": {
        const qp: number[] = [];
        a.quads.forEach((q) => qp.push(q.x, q.y + q.height, q.x + q.width, q.y + q.height, q.x, q.y, q.x + q.width, q.y));
        rect = bounds(a.quads.flatMap((q) => [[q.x, q.y], [q.x + q.width, q.y + q.height]] as [number, number][]), 1);
        dict.Subtype = a.type === "highlight" ? "Highlight" : a.type === "underline" ? "Underline" : "StrikeOut";
        dict.QuadPoints = qp;
        const ops: PDFOperator[] = [pushGraphicsState()];
        if (a.type === "highlight") { ops.push(setGraphicsState("GSa"), setFillingRgbColor(r, g, b)); a.quads.forEach((q) => ops.push(rectangle(q.x, q.y, q.width, q.height))); ops.push(fill()); }
        else {
          ops.push(setStrokingRgbColor(r, g, b));
          a.quads.forEach((q) => { const lw = Math.max(0.5, q.height / 14); const y = a.type === "underline" ? q.y + lw : q.y + q.height * 0.45; ops.push(setLineWidth(lw), moveTo(q.x, y), lineTo(q.x + q.width, y), stroke()); });
        }
        ops.push(popGraphicsState());
        ap = appearance(doc, rect, ops, a.type === "highlight" ? { ExtGState: { GSa: gsAlpha } } : {});
        break;
      }
      case "ink": {
        const w = a.width ?? 2;
        rect = bounds(a.paths.flat(), w);
        dict.Subtype = "Ink"; dict.InkList = a.paths.map((p) => p.flat()); dict.BS = { W: w, S: "S" };
        const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineWidth(w)];
        a.paths.forEach((p) => { if (!p.length) return; ops.push(moveTo(p[0][0], p[0][1])); p.slice(1).forEach((q) => ops.push(lineTo(q[0], q[1]))); if (p.length === 1) ops.push(lineTo(p[0][0] + 0.1, p[0][1])); ops.push(stroke()); });
        ops.push(popGraphicsState());
        ap = appearance(doc, rect, ops);
        break;
      }
      case "note": {
        rect = { x: a.at[0], y: a.at[1] - 20, width: 20, height: 20 };
        dict.Subtype = "Text"; dict.Name = "Comment"; dict.Open = false;
        const { x, y } = rect;
        ap = appearance(doc, rect, [pushGraphicsState(), setFillingRgbColor(r, g, b), setStrokingRgbColor(0.2, 0.2, 0.2), setLineWidth(0.8),
          moveTo(x + 1, y + 19), lineTo(x + 19, y + 19), lineTo(x + 19, y + 6), lineTo(x + 8, y + 6), lineTo(x + 3, y + 1), lineTo(x + 4, y + 6), lineTo(x + 1, y + 6), closePath(), fillAndStroke(),
          moveTo(x + 4, y + 15), lineTo(x + 16, y + 15), moveTo(x + 4, y + 11.5), lineTo(x + 13, y + 11.5), stroke(), popGraphicsState()]);
        break;
      }
      case "freetext": case "stamp": if (rot) {
        // Rotated page: draw in a visual (upright) frame and rotate it with /Matrix; the viewer fits it into /Rect.
        rect = a.rect;
        const vw = rot % 180 ? rect.height : rect.width, vh = rot % 180 ? rect.width : rect.height;
        const ops: PDFOperator[] = [pushGraphicsState()];
        if (a.type === "freetext") {
          const size = a.fontSize ?? 11;
          dict.Subtype = "FreeText"; dict.Contents = txt(a.contents ?? a.text); dict.DA = PDFString.of(`/${fontName} ${size} Tf 0 g`); dict.Rotate = rot;
          ops.push(setFillingRgbColor(1, 1, 1), setStrokingRgbColor(r, g, b), setLineWidth(1), rectangle(0, 0, vw, vh), fillAndStroke(), popGraphicsState(),
            ...textOps(font, fontName, wrap(font, a.text, size, vw - 8), size, 4, vh - 4));
        } else {
          dict.Subtype = "Stamp"; dict.Name = a.label.replace(/[^A-Za-z]/g, "") || "Draft"; dict.Contents = txt(a.contents ?? a.label); dict.Rotate = rot;
          const size = Math.min(vh * 0.5, (vw - 12) / Math.max(1, font.widthOfTextAtSize(a.label, 1)));
          const tw = font.widthOfTextAtSize(a.label, size);
          ops.push(setStrokingRgbColor(r, g, b), setLineWidth(2.5), rectangle(2, 2, vw - 4, vh - 4), stroke(),
            beginText(), setFontAndSize(fontName, size), setFillingRgbColor(r, g, b), moveText((vw - tw) / 2, (vh - size * 0.7) / 2), showText(font.encodeText(a.label)), endText(), popGraphicsState());
        }
        ap = appearance(doc, { x: 0, y: 0, width: vw, height: vh }, ops, fontRes, rotMatrix(rot));
        break;
      } if (a.type === "stamp") { stampUpright(); break; }
      // falls through
      case "callout": {
        if (a.type !== "freetext" && a.type !== "callout") break;
        const size = a.fontSize ?? 11;
        const box = a.rect;
        const lines = wrap(font, a.text, size, box.width - 8);
        const h = Math.max(box.height, lines.length * size * 1.2 + 8);
        const tb: R = { x: box.x, y: box.y + box.height - h, width: box.width, height: h };
        dict.Subtype = "FreeText"; dict.Contents = txt(a.contents ?? a.text);
        dict.DA = PDFString.of(`/${fontName} ${size} Tf 0 g`);
        const ops: PDFOperator[] = [pushGraphicsState(), setFillingRgbColor(1, 1, 1), setStrokingRgbColor(r, g, b), setLineWidth(1), rectangle(tb.x, tb.y, tb.width, tb.height), fillAndStroke()];
        if (a.type === "callout") {
          dict.IT = "FreeTextCallout";
          const knee: [number, number] = [tb.x, tb.y + tb.height / 2];
          dict.CL = [a.anchor[0], a.anchor[1], knee[0] - 12, knee[1], knee[0], knee[1]];
          dict.LE = "OpenArrow";
          ops.push(moveTo(a.anchor[0], a.anchor[1]), lineTo(knee[0] - 12, knee[1]), lineTo(knee[0], knee[1]), stroke());
          ops.push(...arrowHead(a.anchor, [knee[0] - 12, knee[1]]));
          rect = bounds([[tb.x, tb.y], [tb.x + tb.width, tb.y + tb.height], a.anchor], 6);
          dict.RD = [tb.x - rect.x, tb.y - rect.y, rect.x + rect.width - (tb.x + tb.width), rect.y + rect.height - (tb.y + tb.height)];
        } else rect = tb;
        ops.push(popGraphicsState(), ...textOps(font, fontName, lines, size, tb.x + 4, tb.y + tb.height - 4));
        ap = appearance(doc, rect, ops, fontRes);
        break;
      }
      case "square": case "circle": {
        const w = a.width ?? 2; rect = a.rect;
        dict.Subtype = a.type === "square" ? "Square" : "Circle"; dict.BS = { W: w, S: "S" };
        const i = { x: rect.x + w / 2, y: rect.y + w / 2, w: rect.width - w, h: rect.height - w };
        const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineWidth(w)];
        if (a.type === "square") ops.push(rectangle(i.x, i.y, i.w, i.h), stroke());
        else ops.push(...ellipse(i.x + i.w / 2, i.y + i.h / 2, i.w / 2, i.h / 2), stroke());
        ops.push(popGraphicsState());
        ap = appearance(doc, rect, ops);
        break;
      }
      case "line": case "arrow": {
        const w = a.width ?? 2;
        rect = bounds([a.from, a.to], 8 + w);
        dict.Subtype = "Line"; dict.L = [...a.from, ...a.to]; dict.BS = { W: w, S: "S" };
        if (a.type === "arrow") dict.LE = ["None", "OpenArrow"];
        const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineWidth(w), moveTo(...a.from), lineTo(...a.to), stroke()];
        if (a.type === "arrow") ops.push(...arrowHead(a.to, a.from));
        ops.push(popGraphicsState());
        ap = appearance(doc, rect, ops);
        break;
      }
      default: break;
    }
    function stampUpright() {
      if (a.type !== "stamp") return;
      rect = a.rect;
      dict.Subtype = "Stamp"; dict.Name = a.label.replace(/[^A-Za-z]/g, "") || "Draft"; dict.Contents = txt(a.contents ?? a.label);
        const size = Math.min(rect.height * 0.5, (rect.width - 12) / Math.max(1, font.widthOfTextAtSize(a.label, 1)));
        const tw = font.widthOfTextAtSize(a.label, size);
        ap = appearance(doc, rect, [pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineWidth(2.5), rectangle(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4), stroke(),
          beginText(), setFontAndSize(fontName, size), setFillingRgbColor(r, g, b), moveText(rect.x + (rect.width - tw) / 2, rect.y + (rect.height - size * 0.7) / 2), showText(font.encodeText(a.label)), endText(), popGraphicsState()], fontRes);
    }
    dict.Rect = [rect!.x, rect!.y, rect!.x + rect!.width, rect!.y + rect!.height];
    if (ap) dict.AP = { N: ap };
    const ref = ctx.register(ctx.obj(dict as never));
    annotsOf(doc, a.page).push(ref);
  }
  return { bytes: await savePdf(doc), ids };
}

function arrowHead(tip: [number, number], from: [number, number]): PDFOperator[] {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]), L = 9;
  const p1: [number, number] = [tip[0] - L * Math.cos(ang - 0.45), tip[1] - L * Math.sin(ang - 0.45)];
  const p2: [number, number] = [tip[0] - L * Math.cos(ang + 0.45), tip[1] - L * Math.sin(ang + 0.45)];
  return [moveTo(...p1), lineTo(...tip), lineTo(...p2), stroke()];
}
function ellipse(cx: number, cy: number, rx: number, ry: number): PDFOperator[] {
  const k = 0.5523;
  return [moveTo(cx + rx, cy), appendBezierCurve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry), appendBezierCurve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry), appendBezierCurve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy), closePath()];
}

function annotsOf(doc: PDFDocument, pageIndex: number): PDFArray {
  const node = doc.getPage(pageIndex).node;
  let a = node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!a) { a = doc.context.obj([]); node.set(PDFName.of("Annots"), a); }
  return a;
}

const str = (d: PDFDict, k: string) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined; };
const name = (d: PDFDict, k: string) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFName ? v.decodeText() : undefined; };

export interface ParsedAnnot {
  id: string; page: number; subtype: string; author: string; contents: string; modified: Date | null; created: Date | null;
  rect: R; inReplyTo: string | null; stateModel?: string; state?: string; ref?: PDFRef; server?: boolean; supported?: boolean;
}
export async function readAnnotations(bytes: Uint8Array): Promise<ParsedAnnot[]> {
  return parse(await PDFDocument.load(bytes));
}
function parse(doc: PDFDocument): ParsedAnnot[] {
  const out: ParsedAnnot[] = [];
  const byRef = new Map<string, string>();
  const pending: { p: ParsedAnnot; irt: PDFRef | null }[] = [];
  doc.getPages().forEach((pg, pi) => {
    const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i); const d = annots.lookup(i);
      if (!(d instanceof PDFDict) || !(ref instanceof PDFRef)) continue;
      const subtype = name(d, "Subtype") ?? "";
      if (subtype === "Popup" || subtype === "Link" || subtype === "Widget") continue;
      const rr = d.lookupMaybe(PDFName.of("Rect"), PDFArray);
      const n = rr ? rr.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : [0, 0, 0, 0];
      const id = str(d, "NM") ?? `ref-${ref.objectNumber}-${ref.generationNumber}`;
      const irt = d.get(PDFName.of("IRT"));
      const p: ParsedAnnot = { id, page: pi, subtype, author: str(d, "T") ?? "", contents: str(d, "Contents") ?? "",
        modified: parsePdfDate(str(d, "M")), created: parsePdfDate(str(d, "CreationDate")),
        rect: { x: Math.min(n[0], n[2]), y: Math.min(n[1], n[3]), width: Math.abs(n[2] - n[0]), height: Math.abs(n[3] - n[1]) },
        inReplyTo: null, stateModel: str(d, "StateModel") ?? name(d, "StateModel"), state: str(d, "State") ?? name(d, "State"), ref };
      byRef.set(ref.toString(), id);
      pending.push({ p, irt: irt instanceof PDFRef ? irt : null });
    }
  });
  for (const { p, irt } of pending) { p.inReplyTo = irt ? byRef.get(irt.toString()) ?? null : null; out.push(p); }
  return out;
}

export interface Thread { root: ParsedAnnot; replies: ParsedAnnot[]; resolved: boolean; stateBy?: string; stateAt?: Date | null }
export function buildThreads(all: ParsedAnnot[]): Thread[] {
  const roots = all.filter((a) => !a.inReplyTo);
  return roots.map((root) => {
    const kids = all.filter((a) => a.inReplyTo === root.id);
    const states = kids.filter((k) => k.stateModel === "Review").sort((a, b) => (a.modified?.getTime() ?? 0) - (b.modified?.getTime() ?? 0));
    const last = states[states.length - 1];
    return { root, replies: kids.filter((k) => !k.stateModel).sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0)),
      resolved: last?.state === "Completed", stateBy: last?.author, stateAt: last?.modified };
  });
}

async function addChild(bytes: Uint8Array, parentId: string, author: string, extra: Record<string, unknown>, contents: string, date = new Date()) {
  const doc = await PDFDocument.load(bytes);
  const parent = parse(doc).find((a) => a.id === parentId);
  if (!parent) throw new Error("Annotation not found");
  const now = pdfDate(date), id = newId();
  const r = parent.rect;
  const ref = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", NM: PDFString.of(id), T: txt(author), M: PDFString.of(now), CreationDate: PDFString.of(now),
    Contents: txt(contents), IRT: parent.ref!, Rect: [r.x, r.y, r.x + r.width, r.y + r.height], F: 4 | 2 /* hidden: shown in thread, not on page */, P: doc.getPage(parent.page).ref, ...extra } as never));
  annotsOf(doc, parent.page).push(ref);
  return { bytes: await savePdf(doc), id };
}
export const addReply = (bytes: Uint8Array, parentId: string, author: string, contents: string, date?: Date) =>
  addChild(bytes, parentId, author, { RT: PDFName.of("R") }, contents, date);
export const setReviewState = (bytes: Uint8Array, parentId: string, author: string, resolved: boolean, date?: Date) =>
  addChild(bytes, parentId, author, { StateModel: PDFString.of("Review"), State: PDFString.of(resolved ? "Completed" : "None") }, resolved ? `Resolved by ${author}` : `Reopened by ${author}`, date);

/** Remove an annotation and everything that replies to it (eraser / delete). */
export async function deleteAnnotation(bytes: Uint8Array, id: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const all = parse(doc);
  const kill = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const a of all) if (a.inReplyTo && kill.has(a.inReplyTo) && !kill.has(a.id)) { kill.add(a.id); grew = true; } }
  const refs = new Set(all.filter((a) => kill.has(a.id)).map((a) => a.ref!.toString()));
  if (!refs.size) throw new Error("Annotation not found");
  doc.getPages().forEach((pg) => {
    const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i);
      const d = annots.lookup(i);
      const popupOf = d instanceof PDFDict ? d.get(PDFName.of("Parent")) : undefined;
      if ((ref instanceof PDFRef && refs.has(ref.toString())) || (popupOf instanceof PDFRef && refs.has(popupOf.toString()))) {
        annots.remove(i); if (ref instanceof PDFRef) doc.context.delete(ref);
      }
    }
  });
  return savePdf(doc);
}
