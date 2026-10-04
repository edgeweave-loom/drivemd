import { describe, expect, it } from "vitest";
import { escapes, sliceText, writtenAt } from "./written.ts";

describe("escapes", () => {
  it.each([
    ["nothing in plain text", "a == b", "a == b", []],
    ["an escaped mark", "[!note]", "\\[!note]", [0]],
    ["an escaped backslash", "a\\b", "a\\\\b", [1]],
    ["no letter after a backslash", "a\\b", "a\\b", []],
    ["a decimal reference", "==", "&#61;=", [0]],
    ["a hexadecimal reference", "#x", "&#x23;x", [0]],
    ["a named reference", "#x", "&num;x", [0]],
    ["a named reference of two characters", "≂̸!", "&NotEqualTilde;!", [0, 1]],
    ["a reference to no character", "�", "&#0;", [0]],
    ["a reference past Unicode", "�", "&#9999999;", [0]],
    ["an unknown name, as written", "&nosuch;", "&nosuch;", []],
    ["what a quote leaves out", "a\n#b", "a \n> \\#b", [2]],
  ])("finds %s", (_, value, source, found) => {
    expect(escapes(value, source)).toEqual(found);
  });
});

describe("sliceText", () => {
  it("keeps the escapes in the part it takes", () => {
    const part = sliceText(
      { type: "text", value: "a #b #c", data: { escaped: [2, 5] } },
      3,
    );

    expect(part).toEqual({
      type: "text",
      value: "b #c",
      data: { escaped: [2] },
    });
    expect(writtenAt(part, 2, 1)).toBe(false);
    expect(writtenAt(part, 0, 2)).toBe(true);
  });

  it("leaves out escapes when the part has none", () => {
    expect(
      sliceText({ type: "text", value: "#a b", data: { escaped: [0] } }, 1, 3),
    ).toEqual({ type: "text", value: "a " });
  });
});
