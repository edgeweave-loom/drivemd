/** A key, or a rule between keys, in a row that scrolls sideways. */
export interface RowItem {
  /** Its width, its margins included. */
  width: number;
  /** Whether it is a key, which may widen, rather than a rule. */
  key: boolean;
}

/**
 * How much to widen a scrolling row's keys, never narrowing them, so that
 * the last one in view is cut in the middle of its icon: cut in its margin,
 * or between two keys, the row looks whole, and nothing tells that it
 * scrolls. The least widening that puts a key's middle at the row's edge,
 * or none when every key fits.
 */
export function peekScale(items: readonly RowItem[], room: number): number {
  if (items.reduce((total, { width }) => total + width, 0) <= room) return 1;
  let keys = 0;
  let rules = 0;
  let scale = 1;
  for (const { width, key } of items) {
    if (!key) {
      rules += width;
      continue;
    }
    // Each key further in needs less widening than the one before.
    const halfway = (room - rules) / (keys + width / 2);
    if (halfway < 1) break;
    scale = halfway;
    keys += width;
  }
  return scale;
}

/** The keys and rules of a row, as laid out. */
export function rowItems(row: HTMLElement): RowItem[] {
  return [...row.children].map((child) => {
    const { marginLeft, marginRight } = getComputedStyle(child);
    return {
      width:
        child.getBoundingClientRect().width +
        parseFloat(marginLeft) +
        parseFloat(marginRight),
      key: child instanceof HTMLButtonElement,
    };
  });
}
