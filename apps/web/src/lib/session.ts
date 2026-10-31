"use client";
import { create } from "zustand";
import { createEditorApi, type EditorApi, type DocumentRef, type Capabilities } from "@thynkpdf/editor-client";

export type BackendStatus = "unknown" | "online" | "offline";
export interface SessionState {
  api: EditorApi;
  backend: BackendStatus;
  authed: boolean;
  source: "none" | "local" | "backend" | "mock";
  ref: DocumentRef | null;
  caps: Capabilities | null;
  capsError: string | null;
  busy: string | null;
  error: string | null;
  notice: string | null;
  userEmail: string | null;
  set(p: Partial<SessionState>): void;
}
const mock = process.env.NEXT_PUBLIC_API_MOCK === "1";
const api = createEditorApi({ apiUrl: process.env.NEXT_PUBLIC_API_URL, mock });
export const useSession = create<SessionState>((set) => ({
  api, backend: "unknown", authed: mock, source: "none", ref: null, caps: null, capsError: null, busy: null, error: null, notice: null, userEmail: (() => { try { return sessionStorage.getItem("tp-user"); } catch { return null; } })(),
  set: (p) => set(p),
}));
api.onTokensChanged = (t) => {
  useSession.setState({ authed: mock || !!t });
};
