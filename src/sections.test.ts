// @vitest-environment node
import { describe, expect, it } from "vitest";
import { partOf } from "./sections.ts";

const NOTE = [
  "# Guide",
  "",
  "Intro.",
  "",
  "## Water",
  "",
  "Boil it.",
  "",
  "### Cups",
  "",
  "Two.",
  "",
  "## Tea",
  "",
  "```",
  "## Not a heading",
  "```",
  "",
  "Steep it. ^steep",
  "",
  "- Green ^green",
  "- Black",
  "",
  "> A quote",
  "",
  "^quote",
].join("\n");

describe("partOf", () => {
  it("gives the whole note for no part", () => {
    expect(partOf(NOTE, "")).toBe(NOTE);
  });

  it("gives a heading's section, with the headings under it, up to the next of its level", () => {
    expect(partOf(NOTE, "Water")).toBe(
      ["## Water", "", "Boil it.", "", "### Cups", "", "Two.", ""].join("\n"),
    );
  });

  it("finds a heading by its text, whatever its case and marks", () => {
    expect(partOf(NOTE, "cups")).toBe(["### Cups", "", "Two.", ""].join("\n"));
    expect(partOf(NOTE, "Guide")).toBe(NOTE);
  });

  it("leaves code out of the headings", () => {
    expect(partOf(NOTE, "Not a heading")).toBeUndefined();
    expect(partOf(NOTE, "Tea")).toContain("Steep it.");
  });

  it.each([
    ["a paragraph", "^steep", "Steep it. ^steep"],
    ["a list item", "^green", "- Green ^green"],
    ["the block before an ID of its own", "^quote", "> A quote"],
  ])("gives %s a block ID names", (_, part, block) => {
    expect(partOf(NOTE, part)).toBe(block);
  });

  it("gives nothing for a part the note does not have", () => {
    expect(partOf(NOTE, "Coffee")).toBeUndefined();
    expect(partOf(NOTE, "^nothing")).toBeUndefined();
  });

  it("reads notes with Windows line breaks", () => {
    expect(partOf("# A\r\n\r\nOne.\r\n# B\r\nTwo. ^two\r\n", "A")).toBe(
      "# A\r\n\r\nOne.",
    );
    expect(partOf("# A\r\n\r\nOne.\r\n# B\r\nTwo. ^two\r\n", "^two")).toBe(
      "Two. ^two",
    );
  });
});
