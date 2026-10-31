import { computeScale, zoomIn, zoomOut, canvasPixelSize, clampScale } from "./zoom";
const page = { width: 612, height: 792 };
describe("zoom", () => {
  it("fit-width uses container width minus padding", () => { expect(computeScale("fit-width", 1, page, { width: 644, height: 300 })).toBeCloseTo(1); });
  it("fit-page takes the limiting dimension", () => { expect(computeScale("fit-page", 1, page, { width: 2000, height: 824 })).toBeCloseTo(1); });
  it("custom ignores container and clamps", () => { expect(computeScale("custom", 50, page, { width: 10, height: 10 })).toBe(8); });
  it("steps zoom in/out", () => { expect(zoomIn(1)).toBe(1.1); expect(zoomOut(1)).toBe(0.9); expect(zoomIn(8)).toBe(8); expect(clampScale(0)).toBe(0.1); });
  it("scales canvas backing store by DPR and caps size", () => {
    expect(canvasPixelSize(100, 50, 2)).toEqual({ width: 200, height: 100, ratio: 2 });
    const big = canvasPixelSize(4000, 4000, 3); expect(big.width * big.height).toBeLessThanOrEqual(16_777_216);
  });
});
