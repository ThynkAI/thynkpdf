import { FilePenLine, Combine, Minimize2, PenTool, ClipboardList, MessageSquareText, Sparkles, FolderOpen, type LucideIcon } from "lucide-react";
import type { ToolParam } from "./tools";

/** The eight THYNKPDF tools, matching ?tool= ids and the desktop launcher tiles. Icons: lucide (ISC). */
export const TOOL_CATALOG: { id: ToolParam; label: string; blurb: string; Icon: LucideIcon; hue: string }[] = [
  { id: "edit", label: "Edit text", blurb: "Find and replace text in place", Icon: FilePenLine, hue: "from-violet-500 to-indigo-500" },
  { id: "merge-split", label: "Merge & split", blurb: "Reorder, combine, extract pages", Icon: Combine, hue: "from-sky-500 to-cyan-500" },
  { id: "compress", label: "Compress", blurb: "Make files smaller", Icon: Minimize2, hue: "from-emerald-500 to-teal-500" },
  { id: "sign", label: "Sign", blurb: "Sign, or send for signing", Icon: PenTool, hue: "from-fuchsia-500 to-pink-500" },
  { id: "forms", label: "Forms", blurb: "Fill, create and flatten fields", Icon: ClipboardList, hue: "from-amber-500 to-orange-500" },
  { id: "comment", label: "Comment", blurb: "Highlight, draw, add notes", Icon: MessageSquareText, hue: "from-yellow-400 to-amber-500" },
  { id: "ai", label: "Ask AI", blurb: "Questions about this document", Icon: Sparkles, hue: "from-indigo-500 to-purple-500" },
  { id: "documents", label: "Documents", blurb: "Your files, folders, versions", Icon: FolderOpen, hue: "from-slate-500 to-slate-700" },
];
export const toolInfo = (id: ToolParam) => TOOL_CATALOG.find((t) => t.id === id)!;
