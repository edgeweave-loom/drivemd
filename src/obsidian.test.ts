// @vitest-environment node
import type { PhrasingContent, Root } from "mdast";
import { describe, expect, it } from "vitest";
import { remarkComments, remarkHighlights } from "./obsidian.ts";

/** A note of one paragraph holding many line breaks, with a comment. */
function longParagraph(): Root {
  const children: PhrasingContent[] = [{ type: "text", value: "%%x%%" }];
  for (let line = 0; line < 100_000; line += 1) {
    children.push({ type: "text", value: "a ==b== c" }, { type: "break" });
  }
  return { type: "root", children: [{ type: "paragraph", children }] };
}

describe("Obsidian's syntax in a long paragraph", () => {
  it("leaves no part of it out", () => {
    const tree = longParagraph();

    remarkComments()(tree);
    remarkHighlights()(tree);
    const [paragraph] = tree.children;
    expect(
      paragraph?.type === "paragraph" ? paragraph.children.length : 0,
      // Each line splits around its highlight; the comment's line break goes.
    ).toBe(399_999);
  });
});
