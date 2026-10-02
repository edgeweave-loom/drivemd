// @vitest-environment node
import { describe, expect, it } from "vitest";
import { commandKey } from "./keys.ts";

describe("commandKey", () => {
  it("is Cmd on a Mac, where Ctrl+click opens the context menu", () => {
    expect(commandKey({ metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(commandKey({ metaKey: false, ctrlKey: true }, true)).toBe(false);
  });

  it("is Ctrl elsewhere", () => {
    expect(commandKey({ metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(commandKey({ metaKey: true, ctrlKey: false }, false)).toBe(false);
  });
});
