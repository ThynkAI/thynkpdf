"use client";
import { TOOL_CATALOG } from "@/lib/toolCatalog";
import type { ToolParam } from "@/lib/tools";

/** "All tools" list at the top of the right pane. */
export function ToolsPane({ active, onTool }: { active: ToolParam | null; onTool(t: ToolParam): void }) {
  return (
    <section aria-labelledby="tools-h">
      <h2 id="tools-h" className="mb-2 font-semibold">All tools</h2>
      <ul className="grid grid-cols-2 gap-1" data-testid="tools-pane">
        {TOOL_CATALOG.map(({ id, label, Icon }) => (
          <li key={id}>
            <button aria-label={`Tool: ${label}`} aria-current={active === id ? "true" : undefined} onClick={() => onTool(id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800 ${active === id ? "bg-brand-500/10 font-medium text-brand-700 dark:text-brand-300" : ""}`}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded ${active === id ? "bg-brand-600" : "bg-ink dark:bg-neutral-700"} text-white`}><Icon aria-hidden className="h-4 w-4" strokeWidth={2} /></span>{label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
