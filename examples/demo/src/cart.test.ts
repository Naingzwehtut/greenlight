import { describe, expect, it } from "vitest";
import { subtotal, total, type Item } from "./cart";

const items: Item[] = [
  { name: "coffee", price: 450, quantity: 2 },
  { name: "bagel", price: 300, quantity: 1 },
];

describe("subtotal", () => {
  it("multiplies price by quantity", () => {
    expect(subtotal(items)).toBe(1200);
  });

  it("is zero for an empty cart", () => {
    expect(subtotal([])).toBe(0);
  });
});

describe("total", () => {
  it("applies the discount before tax", () => {
    expect(total(items, { discount: 0.1, taxRate: 0.08 })).toBe(1166);
  });
});
