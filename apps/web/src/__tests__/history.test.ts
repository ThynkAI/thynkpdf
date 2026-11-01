import { CommandStack } from "@/lib/history";
import { resolveShortcut } from "@/lib/shortcuts";

const counter = () => { const s = { v: 0 }; return { s, cmd: (n: number) => ({ label: `+${n}`, undo: async () => { s.v -= n; }, redo: async () => { s.v += n; } }) }; };

describe("CommandStack (undo/redo)", () => {
  it("undoes and redoes in order", async () => {
    const { s, cmd } = counter(); const st = new CommandStack();
    s.v += 1; st.push(cmd(1)); s.v += 2; st.push(cmd(2));
    expect(st.undoLabel).toBe("+2");
    expect(await st.undo()).toBe("+2"); expect(s.v).toBe(1);
    expect(await st.undo()).toBe("+1"); expect(s.v).toBe(0);
    expect(st.canUndo).toBe(false); expect(await st.undo()).toBeNull();
    expect(await st.redo()).toBe("+1"); expect(await st.redo()).toBe("+2"); expect(s.v).toBe(3);
  });
  it("a new command clears the redo branch", async () => {
    const { s, cmd } = counter(); const st = new CommandStack();
    s.v += 1; st.push(cmd(1)); await st.undo();
    expect(st.canRedo).toBe(true);
    s.v += 5; st.push(cmd(5));
    expect(st.canRedo).toBe(false); expect(st.sizes).toEqual({ past: 1, future: 0 });
  });
  it("drops a step whose undo reports failure", async () => {
    const st = new CommandStack(); st.push({ label: "x", undo: async () => false, redo: async () => true });
    expect(await st.undo()).toBeNull(); expect(st.canUndo).toBe(false); expect(st.canRedo).toBe(false);
  });
  it("caps history length", () => {
    const st = new CommandStack(3); for (let i = 0; i < 5; i++) st.push({ label: String(i), undo: async () => {}, redo: async () => {} });
    expect(st.sizes.past).toBe(3); expect(st.undoLabel).toBe("4");
  });
});

describe("editing shortcuts (Ctrl or Cmd)", () => {
  const body = document.body;
  it("maps undo/redo/clipboard with either modifier", () => {
    expect(resolveShortcut({ key: "z", ctrlKey: true, target: body })).toBe("undo");
    expect(resolveShortcut({ key: "z", metaKey: true, target: body })).toBe("undo");
    expect(resolveShortcut({ key: "Z", metaKey: true, shiftKey: true, target: body })).toBe("redo");
    expect(resolveShortcut({ key: "y", ctrlKey: true, target: body })).toBe("redo");
    expect(resolveShortcut({ key: "c", ctrlKey: true, target: body })).toBe("copy");
    expect(resolveShortcut({ key: "x", metaKey: true, target: body })).toBe("cut");
    expect(resolveShortcut({ key: "v", ctrlKey: true, target: body })).toBe("paste");
    expect(resolveShortcut({ key: "a", ctrlKey: true, target: body })).toBe("selectAll");
    expect(resolveShortcut({ key: "Delete", target: body })).toBe("delete");
    expect(resolveShortcut({ key: "?", shiftKey: true, target: body })).toBe("help");
  });
  it("leaves text fields to native editing", () => {
    const input = document.createElement("input");
    for (const k of ["z", "y", "c", "x", "v", "a"]) expect(resolveShortcut({ key: k, ctrlKey: true, target: input })).toBeNull();
    expect(resolveShortcut({ key: "Backspace", target: input })).toBeNull();
  });
});
