export interface Item {
  name: string;
  price: number; // in cents
  quantity: number;
}

export interface TotalOptions {
  /** Discount as a fraction, e.g. 0.1 for 10% off. */
  discount?: number;
  /** Tax rate as a fraction, applied after the discount. */
  taxRate?: number;
}

export function subtotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export function total(items: Item[], opts: TotalOptions = {}): number {
  const afterDiscount = subtotal(items) * (1 - (opts.discount ?? 0));
  const withTax = afterDiscount * (1 + (opts.taxRate ?? 0));
  return Math.round(withTax);
}
