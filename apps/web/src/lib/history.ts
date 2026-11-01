"use client";
import { create } from "zustand";

/** One undoable step. undo/redo return false when they could not be applied (the step is then dropped). */
export interface Command { label: string; undo(): Promise<boolean | void>; redo(): Promise<boolean | void> }

/** Pure command-history stack (unit-tested). New commands clear the redo branch; size is capped. */
export class CommandStack {
  private past: Command[] = [];
  private future: Command[] = [];
  constructor(private limit = 100) {}
  push(c: Command) { this.past.push(c); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label ?? null; }
  get redoLabel() { return this.future[this.future.length - 1]?.label ?? null; }
  async undo(): Promise<string | null> {
    const c = this.past.pop(); if (!c) return null;
    if ((await c.undo()) === false) return null;
    this.future.push(c); return c.label;
  }
  async redo(): Promise<string | null> {
    const c = this.future.pop(); if (!c) return null;
    if ((await c.redo()) === false) return null;
    this.past.push(c); return c.label;
  }
  clear() { this.past = []; this.future = []; }
  get sizes() { return { past: this.past.length, future: this.future.length }; }
}

interface HistoryView { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
export const stack = new CommandStack();
export const useHistory = create<HistoryView>(() => ({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }));
const sync = () => useHistory.setState({ canUndo: stack.canUndo, canRedo: stack.canRedo, undoLabel: stack.undoLabel, redoLabel: stack.redoLabel });

/** True while an undo/redo is replaying, so the operations it runs are not recorded again. */
export let replaying = false;
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };

export function record(c: Command) { if (replaying) return; stack.push(c); sync(); }
export function clearHistory() { stack.clear(); sync(); }
async function replay(fn: () => Promise<string | null>) {
  replaying = true;
  try { return await fn(); } finally { replaying = false; sync(); }
}
export const undo = () => serial(() => replay(() => stack.undo()));
export const redo = () => serial(() => replay(() => stack.redo()));
