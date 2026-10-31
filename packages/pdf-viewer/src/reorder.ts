/** Move page `from` to position `to` (0-based) and return the backend's 1-based permutation (new position -> old page number). */
export function moveOrder(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i + 1);
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return order;
  const [m] = order.splice(from, 1);
  order.splice(to, 0, m);
  return order;
}
export const isIdentity = (order: number[]) => order.every((n, i) => n === i + 1);
