/** ?tool= deep links. Unknown values are ignored. */
export const TOOLS = ["edit", "merge-split", "compress", "sign", "forms", "comment", "ai", "documents"] as const;
export type ToolParam = (typeof TOOLS)[number];
/** Ids used by the desktop launcher (apps/desktop/launcher). */
const ALIASES: Record<string, ToolParam> = { merge: "merge-split", split: "merge-split", annotate: "comment", comments: "comment" };
export function parseTool(search: string): ToolParam | null {
  const raw = new URLSearchParams(search).get("tool")?.trim().toLowerCase() ?? "";
  const v = ALIASES[raw] ?? raw;
  return (TOOLS as readonly string[]).includes(v) ? (v as ToolParam) : null;
}
/** What the editor opens for each tool: a right-panel section (heading id), the organizer, annotation mode, or the dashboard. */
export function toolAction(t: ToolParam): { panelSection?: string; organizer?: "pages" | "compress"; annotate?: boolean; navigate?: string } {
  switch (t) {
    case "edit": return { panelSection: "te-h" };
    case "merge-split": return { organizer: "pages" };
    case "compress": return { organizer: "compress" };
    case "sign": return { panelSection: "sign-h" };
    case "forms": return { panelSection: "forms-h" };
    case "comment": return { panelSection: "cm-h", annotate: true };
    case "ai": return { panelSection: "ai-h" };
    case "documents": return { navigate: "/documents" };
  }
}
