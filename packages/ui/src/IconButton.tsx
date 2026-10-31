"use client";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { label: string; shortcut?: string; children: ReactNode; active?: boolean }
export function IconButton({ label, shortcut, children, active, className, ...rest }: IconButtonProps) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>
        <button type="button" aria-label={label} aria-pressed={active} {...rest}
          className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 text-sm hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-700 ${active ? "bg-neutral-200 dark:bg-neutral-700" : ""} ${className ?? ""}`}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={4} className="z-50 rounded bg-neutral-900 px-2 py-1 text-xs text-white shadow">
          {label}{shortcut ? <kbd className="ml-2 opacity-70">{shortcut}</kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export const TooltipProvider = Tooltip.Provider;
