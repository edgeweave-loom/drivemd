import { describe, expect, it } from "vitest";
import { readSettings } from "./vault-settings.ts";

function utf8(text: string) {
  return new TextEncoder().encode(text);
}

describe("readSettings", () => {
  it("reads strictLineBreaks", () => {
    expect(readSettings(utf8('{"strictLineBreaks": true}'))).toEqual({
      strictLineBreaks: true,
    });
  });

  it("reads a file that starts with a byte order mark", () => {
    expect(readSettings(utf8('﻿{"strictLineBreaks": true}'))).toEqual({
      strictLineBreaks: true,
    });
  });

  it.each([
    ["leaves the key out", "{}"],
    ["sets it to something else than true", '{"strictLineBreaks": "yes"}'],
    ["is not JSON", "{strictLineBreaks"],
    ["holds a list", "[true]"],
    ["holds null", "null"],
  ])("gives Obsidian's defaults when the file %s", (_, text) => {
    expect(readSettings(utf8(text))).toEqual({ strictLineBreaks: false });
  });
});
