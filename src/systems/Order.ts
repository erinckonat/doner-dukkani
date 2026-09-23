import type { ProductKind } from '../config/balance';

/** How many of each product a customer wants (or has received). */
export type Order = Partial<Record<ProductKind, number>>;

export const orderTotal = (o: Order) => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);

/** What is still owed, in order: [kind, count] pairs with count > 0. */
export function remaining(order: Order, got: Order): [ProductKind, number][] {
  const out: [ProductKind, number][] = [];
  for (const [k, n] of Object.entries(order) as [ProductKind, number][]) {
    const left = n - (got[k] ?? 0);
    if (left > 0) out.push([k, left]);
  }
  return out;
}

export const isComplete = (order: Order, got: Order) => remaining(order, got).length === 0;
