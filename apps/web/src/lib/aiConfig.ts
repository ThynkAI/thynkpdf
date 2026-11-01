"use client";
import { create } from "zustand";
import type { AiConfig } from "./desktopBridge";
/** Non-secret view of the desktop AI provider config (no keys, only "hasKey"). */
export const useAiConfig = create<{ cfg: AiConfig | null; set(c: AiConfig): void }>((set) => ({ cfg: null, set: (c) => set({ cfg: c }) }));
