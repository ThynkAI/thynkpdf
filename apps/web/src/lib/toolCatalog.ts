import { FilePenLine, Combine, Minimize2, PenTool, ClipboardList, MessageSquareText, Sparkles, FolderOpen, type LucideIcon } from "lucide-react";
import type { ToolParam } from "./tools";

/** The eight THYNKPDF tools, matching ?tool= ids and the desktop launcher tiles. Icons: lucide (ISC). */
export const TOOL_CATALOG: { id: ToolParam; label: string; blurb: string; Icon: LucideIcon; hue: string }[] = [
  { id: "edit", label: "Edit text", blurb: "Find and replace text in place", Icon: FilePenLine, hue: "bg-ink dark:bg-neutral-800" },
  { id: "merge-split", label: "Merge & split", blurb: "Reorder, combine, extract pages", Icon: Combine, hue: "bg-ink dark:bg-neutral-800" },
  { id: "compress", label: "Compress", blurb: "Make files smaller", Icon: Minimize2, hue: "bg-ink dark:bg-neutral-800" },
  { id: "sign", label: "Sign", blurb: "Sign, or send for signing", Icon: PenTool, hue: "bg-ink dark:bg-neutral-800" },
  { id: "forms", label: "Forms", blurb: "Fill, create and flatten fields", Icon: ClipboardList, hue: "bg-ink dark:bg-neutral-800" },
  { id: "comment", label: "Comment", blurb: "Highlight, draw, add notes", Icon: MessageSquareText, hue: "bg-ink dark:bg-neutral-800" },
  { id: "ai", label: "Ask AI", blurb: "Questions about this document", Icon: Sparkles, hue: "bg-ink dark:bg-neutral-800" },
  { id: "documents", label: "Documents", blurb: "Your files, folders, versions", Icon: FolderOpen, hue: "bg-ink dark:bg-neutral-800" },
];
export const toolInfo = (id: ToolParam) => TOOL_CATALOG.find((t) => t.id === id)!;
