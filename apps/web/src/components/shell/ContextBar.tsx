"use client";
import { X } from "lucide-react";
import { toolInfo } from "@/lib/toolCatalog";
import type { ToolParam } from "@/lib/tools";

const HINT: Partial<Record<ToolParam, string>> = {
  edit: "Find text and replace it — the result is saved as a new version.",
  "merge-split": "Drag pages to reorder; select pages to extract, split or merge.",
  compress: "Pick a preset; the smaller file is saved as a new version.",
  sign: "Create a signature, place it on the page, then apply. Or request signatures from others.",
  forms: "Fill existing fields, add new ones, or flatten the form.",
  ai: "Ask a question; answers cite the pages they come from.",
};
/** Contextual sub-toolbar for the active tool (Comment uses the full annotation toolbar instead). */
export function ContextBar({ tool, onDone, children }: { tool: ToolParam; onDone(): void; children?: React.ReactNode }) {
  const { label, Icon } = toolInfo(tool);
  return (
    <div role="toolbar" aria-label={`${label} tool`} data-testid="context-bar"
      className="flex h-10 items-center gap-2 border-b border-neutral-200 bg-brand-500/5 px-3 text-sm dark:border-neutral-800">
      <Icon aria-hidden className="h-4 w-4 text-brand-600 dark:text-brand-300" />
      <span className="font-medium">{label}</span>
      {HINT[tool] && <span className="hidden truncate text-neutral-600 md:inline dark:text-neutral-400">{HINT[tool]}</span>}
      {children}
      <button onClick={onDone} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={`Close ${label} tool`}>
        <X aria-hidden className="h-3.5 w-3.5" />Done
      </button>
    </div>
  );
}
