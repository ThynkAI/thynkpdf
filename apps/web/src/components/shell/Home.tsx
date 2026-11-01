"use client";
import { Wordmark } from "@thynkpdf/ui";
import { Upload } from "lucide-react";
import { TOOL_CATALOG } from "@/lib/toolCatalog";
import type { ToolParam } from "@/lib/tools";

/** Start screen: 8 tool tiles (same ids as ?tool= and the desktop launcher) plus an open/drop target. */
export function Home({ onTool, onOpen }: { onTool(t: ToolParam): void; onOpen(): void }) {
  return (
    <section aria-labelledby="home-h" data-testid="home" className="absolute inset-0 overflow-auto bg-gradient-to-b from-paper to-white dark:from-ink dark:to-ink">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-10">
        <Wordmark className="scale-150" />
        <h1 id="home-h" className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">What would you like to do?</h1>
        <button onClick={onOpen} className="flex w-full max-w-xl flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand-400/60 bg-white/70 px-6 py-6 text-neutral-700 hover:border-brand-500 hover:bg-brand-500/5 dark:border-brand-400/50 dark:bg-neutral-900/60 dark:text-neutral-200">
          <Upload aria-hidden strokeWidth={2} className="h-7 w-7 text-brand-600 dark:text-brand-300" />
          <span className="font-medium">Open PDF</span>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">or drop a file anywhere · <kbd>Ctrl+O</kbd></span>
        </button>
        <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Tools">
          {TOOL_CATALOG.map(({ id, label, blurb, Icon, hue }) => (
            <li key={id}>
              <button data-testid={`home-tile-${id}`} onClick={() => onTool(id)}
                className="group flex h-full w-full flex-col items-start gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-neutral-800 dark:bg-neutral-900">
                <span className={`grid h-11 w-11 place-items-center rounded-lg shadow-sm ring-1 ring-black/5 ${hue} text-white transition-colors group-hover:bg-brand-600 dark:group-hover:bg-brand-600`}><Icon aria-hidden className="h-6 w-6" strokeWidth={2} absoluteStrokeWidth={false} /></span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
                <span className="text-xs text-neutral-600 dark:text-neutral-400">{blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
