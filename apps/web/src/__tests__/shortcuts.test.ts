import { resolveShortcut } from "@/lib/shortcuts";
describe("resolveShortcut", () => {
  it.each([
    [{ key: "o", ctrlKey: true }, "open"], [{ key: "f", metaKey: true }, "find"], [{ key: "=", ctrlKey: true }, "zoomIn"],
    [{ key: "-", ctrlKey: true }, "zoomOut"], [{ key: "0", ctrlKey: true }, "fitWidth"], [{ key: "R", ctrlKey: true, shiftKey: true }, "rotate"],
    [{ key: "PageDown" }, "nextPage"], [{ key: "k" }, "prevPage"], [{ key: "End" }, "lastPage"], [{ key: "r", ctrlKey: true }, null],
  ])("%o -> %s", (e, a) => expect(resolveShortcut(e)).toBe(a));
  it("ignores plain keys while typing in inputs", () => {
    expect(resolveShortcut({ key: "j", target: document.createElement("input") })).toBeNull();
  });
});
