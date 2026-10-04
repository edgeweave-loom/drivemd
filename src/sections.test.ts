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
  it("gives the whole note for no part, but its properties", () => {
    expect(partOf(NOTE, "")).toBe(NOTE);
    expect(partOf("---\ntitle: Tea\n---\n# Tea", "")).toBe("# Tea");
  });

  it("reads a long line of spaces in no time", () => {
    const line = `# a${" ".repeat(100_000)}b`;

    expect(partOf(line, "x")).toBeUndefined();
    expect(partOf(`${line}\n\nText ^id`, "^id")).toBe("Text ^id");
  });

  it("finds a heading underlined with = or -", () => {
    const note = "Title\n=====\n\nBody.\n\nSub\n---\n\nMore.\n\nNext\n====\n";
    expect(partOf(note, "Title")).toBe(
      "Title\n=====\n\nBody.\n\nSub\n---\n\nMore.\n",
    );
    expect(partOf(note, "Sub")).toBe("Sub\n---\n\nMore.\n");
  });

  it.each([
    ["properties", "---\n# Not a heading\n---\n# Real"],
    ["a comment", "%%\n# Not a heading\n%%\n# Real"],
  ])("finds no heading in %s", (_, note) => {
    expect(partOf(note, "Not a heading")).toBeUndefined();
    expect(partOf(note, "Real")).toBe("# Real");
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

  it("gives a list item with the items under it", () => {
    expect(partOf("- parent ^item\n  - child\n- next", "^item")).toBe(
      "- parent ^item\n  - child",
    );
  });

  it.each([
    ["a list", "Para ^id\n- item"],
    ["code", "Para ^id\n```\ncode\n```"],
    ["a heading", "# Title\nPara ^id"],
  ])("ends a paragraph's block at %s", (_, note) => {
    expect(partOf(note, "^id")).toBe("Para ^id");
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
