import { findMatches, highlightSegments } from "./search";
describe("search", () => {
  it("finds case-insensitive matches across pages", () => {
    const m = findMatches(["Needle a needle", "none", "NEEDLE"], "needle");
    expect(m.map((x) => x.page)).toEqual([0, 0, 2]);
  });
  it("empty query yields nothing", () => expect(findMatches(["abc"], "  ")).toEqual([]));
  it("splits highlight segments", () => {
    expect(highlightSegments("a Fox fox", "fox")).toEqual([{ text: "a ", hit: false }, { text: "Fox", hit: true }, { text: " ", hit: false }, { text: "fox", hit: true }]);
  });
});
