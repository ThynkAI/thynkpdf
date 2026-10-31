export type Action = "open" | "find" | "zoomIn" | "zoomOut" | "fitWidth" | "fitPage" | "nextPage" | "prevPage" | "firstPage" | "lastPage" | "rotate" | "toggleTheme";
export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: EventTarget | null }

const isTyping = (t: EventTarget | null | undefined) =>
  !!t && typeof (t as HTMLElement).tagName === "string" && (/^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement).tagName) || (t as HTMLElement).isContentEditable);

export function resolveShortcut(e: KeyLike): Action | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod) {
    switch (e.key.toLowerCase()) {
      case "o": return "open";
      case "f": return "find";
      case "=": case "+": return "zoomIn";
      case "-": return "zoomOut";
      case "0": return "fitWidth";
      case "9": return "fitPage";
      case "r": return e.shiftKey ? "rotate" : null;
    }
    return null;
  }
  if (isTyping(e.target) || e.altKey) return null;
  switch (e.key) {
    case "PageDown": case "j": case "ArrowRight": return "nextPage";
    case "PageUp": case "k": case "ArrowLeft": return "prevPage";
    case "Home": return "firstPage";
    case "End": return "lastPage";
  }
  return null;
}
