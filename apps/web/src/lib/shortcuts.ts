export type Action = "open" | "find" | "zoomIn" | "zoomOut" | "fitWidth" | "fitPage" | "nextPage" | "prevPage" | "firstPage" | "lastPage" | "rotate" | "rotateCcw" | "toggleTheme"
  | "undo" | "redo" | "copy" | "cut" | "paste" | "selectAll" | "delete" | "escape" | "help" | "save" | "print" | "duplicate" | "settings";
export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: EventTarget | null }

const isTyping = (t: EventTarget | null | undefined) =>
  !!t && typeof (t as HTMLElement).tagName === "string" && (/^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement).tagName) || (t as HTMLElement).isContentEditable);

const inDialog = (t: EventTarget | null | undefined) => !!t && typeof (t as Element).closest === "function" && !!(t as Element).closest('[role="dialog"]');

/** Ctrl on Windows/Linux, Cmd on macOS: either modifier is accepted everywhere. */
export function resolveShortcut(e: KeyLike): Action | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  const typing = isTyping(e.target);
  if (mod) {
    const k = e.key.toLowerCase();
    // Editing shortcuts belong to the text field while typing (native undo/copy/paste/select-all there).
    if (typing && ["z", "y", "c", "x", "v", "a"].includes(k)) return null;
    if (inDialog(e.target) && ["z", "y", "c", "x", "v", "a", "d"].includes(k)) return null;
    switch (k) {
      case "o": return "open";
      case "f": return "find";
      case "=": case "+": return "zoomIn";
      case "-": return "zoomOut";
      case "0": return "fitWidth";
      case "9": return "fitPage";
      case "r": return e.shiftKey ? "rotate" : null;
      case "l": return e.shiftKey ? "rotateCcw" : null;
      case "z": return e.shiftKey ? "redo" : "undo";
      case "y": return "redo";
      case "c": return "copy";
      case "x": return "cut";
      case "v": return "paste";
      case "a": return "selectAll";
      case "d": return "duplicate";
      case "s": return "save";
      case "p": return "print";
      case ",": return "settings";
      case "/": return "help";
    }
    return null;
  }
  if (e.key === "Escape") return "escape";
  if (typing || e.altKey || inDialog(e.target)) return null;
  switch (e.key) {
    case "PageDown": case "j": case "ArrowRight": return "nextPage";
    case "PageUp": case "k": case "ArrowLeft": return "prevPage";
    case "Home": return "firstPage";
    case "End": return "lastPage";
    case "Delete": case "Backspace": return "delete";
    case "?": return "help";
  }
  return null;
}

const mac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Human label, e.g. "Ctrl+Shift+Z" or "⌘⇧Z" on macOS. */
export function keyLabel(combo: string, isMac = mac()) {
  if (!isMac) return combo.replace("Mod", "Ctrl");
  return combo.replace("Mod+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥");
}

export const SHORTCUT_HELP: { group: string; items: [string, string][] }[] = [
  { group: "Edit", items: [["Mod+Z", "Undo"], ["Mod+Shift+Z", "Redo"], ["Mod+Y", "Redo"], ["Mod+C", "Copy selected annotations, text or the current page"], ["Mod+X", "Cut selected annotations or the current page"], ["Mod+V", "Paste annotations onto / pages after the current page"], ["Mod+A", "Select all text on the current page"], ["Delete", "Delete selected annotations"], ["Mod+D", "Duplicate the current page"], ["Esc", "Clear selection / close dialog"]] },
  { group: "Pages", items: [["Mod+Shift+R", "Rotate page clockwise"], ["Mod+Shift+L", "Rotate page counter-clockwise"], ["J / → / PgDn", "Next page"], ["K / ← / PgUp", "Previous page"], ["Home / End", "First / last page"]] },
  { group: "View", items: [["Mod+=", "Zoom in"], ["Mod+-", "Zoom out"], ["Mod+0", "Fit width"], ["Mod+9", "Fit page"], ["Mod+F", "Find in document"]] },
  { group: "File", items: [["Mod+O", "Open PDF"], ["Mod+S", "Save / download annotated copy"], ["Mod+P", "Print"], ["Mod+,", "Settings (AI Providers)"], ["?", "Keyboard shortcuts"]] },
];
