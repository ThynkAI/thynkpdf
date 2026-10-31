import { useViewerStore } from "./store";
const sizes = Array.from({ length: 5 }, () => ({ width: 100, height: 200 }));
beforeEach(() => useViewerStore.getState().setDocument({} as never, "a.pdf", sizes));
describe("viewer store", () => {
  it("clamps navigation", () => {
    const s = useViewerStore.getState();
    s.goToPage(99); expect(useViewerStore.getState().currentPage).toBe(4);
    s.goToPage(-3); expect(useViewerStore.getState().currentPage).toBe(0);
  });
  it("search navigates to matches and cycles", () => {
    const s = useViewerStore.getState();
    s.setPagesText(["x", "hit", "", "hit hit", ""]);
    s.setQuery("hit");
    let st = useViewerStore.getState();
    expect(st.matches).toHaveLength(3); expect(st.currentPage).toBe(1);
    st.nextMatch(1); st = useViewerStore.getState(); expect(st.currentPage).toBe(3);
    st.nextMatch(-1); st.nextMatch(-1); expect(useViewerStore.getState().activeMatch).toBe(2);
  });
  it("zoom in switches to custom mode", () => {
    const s = useViewerStore.getState(); s.setEffectiveScale(1); s.zoomIn();
    expect(useViewerStore.getState()).toMatchObject({ zoomMode: "custom", customScale: 1.1 });
  });
  it("keeps page on version reload", () => {
    useViewerStore.getState().goToPage(3);
    useViewerStore.getState().setDocument({} as never, "a.pdf", sizes, true);
    expect(useViewerStore.getState().currentPage).toBe(3);
  });
});
