"use client";
import { Info, AlertTriangle } from "lucide-react";
import type { Limitation } from "@thynkpdf/editor-client";
import { friendlyNotices } from "@/lib/limitations";

/** Plain-language banners for backend limitation codes, with the raw codes behind a collapsible "Details". */
export function LimitationNotices({ limitations, testId }: { limitations: readonly Pick<Limitation, "code" | "message">[] | null | undefined; testId?: string }) {
  const notices = friendlyNotices(limitations);
  if (!notices.length) return null;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {notices.map((n) => {
        const Icon = n.tone === "info" ? Info : AlertTriangle;
        return (
          <div key={n.key} role="note" data-testid={`notice-${n.key}`}
            className={`rounded border px-2 py-1.5 text-xs ${n.tone === "info" ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
            <p className="flex gap-1.5"><Icon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" /><span>{n.text}</span></p>
            {n.details.length > 0 && (
              <details className="mt-1 pl-5">
                <summary className="cursor-pointer select-none opacity-80">Details</summary>
                <ul className="mt-1 space-y-0.5 break-words font-mono text-[10px] opacity-80">{n.details.map((d) => <li key={d}>{d}</li>)}</ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
