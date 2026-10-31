"use client";
import { create } from "zustand";
import { createEditorApi, type EditorApi, type DocumentRef } from "@thynkpdf/editor-client";

export type BackendStatus = "unknown" | "online" | "offline";
export interface SessionState {
  api: EditorApi;
  backend: BackendStatus;
  authed: boolean;
  source: "none" | "local" | "backend" | "mock";
  ref: DocumentRef | null;
  busy: string | null;
  error: string | null;
  set(p: Partial<SessionState>): void;
}
const mock = process.env.NEXT_PUBLIC_API_MOCK === "1";
export const useSession = create<SessionState>((set) => ({
  api: createEditorApi({ apiUrl: process.env.NEXT_PUBLIC_API_URL, mock }),
  backend: "unknown", authed: mock, source: "none", ref: null, busy: null, error: null,
  set: (p) => set(p),
}));
