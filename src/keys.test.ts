// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ariaKeys, commandKey, keyLabel } from "./keys.ts";

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

describe("keyLabel", () => {
  it("writes a key as a Mac does, or as other systems do", () => {
    expect(keyLabel("Mod-Shift-8", true)).toBe("⌘⇧8");
    expect(keyLabel("Mod-Shift-8", false)).toBe("Ctrl+Shift+8");
    expect(keyLabel("Mod-b", false)).toBe("Ctrl+B");
    expect(keyLabel("Mod-]", true)).toBe("⌘]");
  });
});

describe("ariaKeys", () => {
  it("writes a key as aria-keyshortcuts does", () => {
    expect(ariaKeys("Mod-Shift-x", true)).toBe("Meta+Shift+X");
    expect(ariaKeys("Mod-b", false)).toBe("Control+B");
  });
});
