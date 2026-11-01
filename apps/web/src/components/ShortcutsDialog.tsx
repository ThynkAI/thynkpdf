"use client";
import { SHORTCUT_HELP, keyLabel } from "@/lib/shortcuts";

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="ks-h" data-testid="shortcuts-dialog" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-neutral-900">
        <div className="mb-3 flex items-center"><h2 id="ks-h" className="text-base font-semibold">Keyboard shortcuts</h2>
          <button autoFocus className="ml-auto rounded px-2 py-1 text-xs underline" onClick={onClose}>Close (Esc)</button></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHORTCUT_HELP.map((g) => (
            <section key={g.group}><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#E8141C]">{g.group}</h3>
              <dl className="space-y-1">{g.items.map(([k, d]) => (
                <div key={k + d} className="flex items-baseline gap-2"><dt className="min-w-[7.5rem]"><kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800">{keyLabel(k)}</kbd></dt><dd className="text-xs text-neutral-700 dark:text-neutral-300">{d}</dd></div>))}
              </dl></section>))}
        </div>
        <p className="mt-3 text-[11px] text-neutral-500">On macOS use ⌘ (Cmd) where Ctrl is shown. Inside text fields the usual text shortcuts apply.</p>
      </div>
    </div>
  );
}
