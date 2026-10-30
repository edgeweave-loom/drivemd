// @vitest-environment node
import { describe, expect, it } from "vitest";
import { peekScale, type RowItem } from "./peek.ts";

const key = (width: number): RowItem => ({ width, key: true });
const rule: RowItem = { width: 5, key: false };

/** Where the row's edge cuts it once widened: which key, and how far in. */
function cut(items: readonly RowItem[], room: number) {
  const scale = peekScale(items, room);
  let start = 0;
  for (const [index, { width, key }] of items.entries()) {
    const widened = key ? width * scale : width;
    if (start + widened > room) return { index, at: (room - start) / widened };
    start += widened;
  }
  return null;
}

describe("peekScale", () => {
  const main = Array.from({ length: 10 }, () => key(44));

  it("cuts the last key in view in the middle, on every phone held upright", () => {
    for (const room of [375, 390, 393, 402, 412, 430]) {
      expect(cut(main, room)?.at).toBeCloseTo(0.5);
    }
    // Eight keys and a half on an iPhone 15, 393 px wide.
    expect(cut(main, 393)?.index).toBe(8);
  });

  it("widens the keys as little as it can, and never narrows them", () => {
    expect(peekScale(main, 393)).toBeCloseTo(393 / (8.5 * 44));
    // Already cut in the middle.
    expect(peekScale(main, 8.5 * 44)).toBe(1);
    // Too narrow for half a key.
    expect(peekScale(main, 10)).toBe(1);
  });

  it("leaves the keys as they are when they all fit", () => {
    expect(peekScale(main, 440)).toBe(1);
    expect(cut(main, 440)).toBeNull();
  });

  it("widens the keys alone, the rules between them keeping their width", () => {
    // A table's cell's keys, Table options aside, on an iPhone 15.
    const cell = [
      key(40),
      key(40),
      rule,
      key(40),
      key(40),
      rule,
      key(40),
      key(40),
      rule,
      key(40),
      key(40),
      key(40),
      rule,
      key(44),
      key(44),
      key(44),
    ];
    const room = 393 - 5 - 44;
    // Align center, cut in the middle.
    expect(cut(cell, room)?.index).toBe(10);
    expect(cut(cell, room)?.at).toBeCloseTo(0.5);
    expect(peekScale(cell, room)).toBeCloseTo((room - 15) / (7 * 40 + 20));
  });
});
