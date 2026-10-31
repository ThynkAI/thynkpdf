import { moveOrder, isIdentity } from "./reorder";
describe("moveOrder", () => {
  it("moves forward and backward (1-based permutation)", () => {
    expect(moveOrder(4, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveOrder(4, 3, 0)).toEqual([4, 1, 2, 3]);
  });
  it("no-ops and out of range return identity", () => {
    expect(isIdentity(moveOrder(3, 1, 1))).toBe(true);
    expect(isIdentity(moveOrder(3, 5, 0))).toBe(true);
  });
});
