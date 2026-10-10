import { afterEach, describe, expect, it, vi } from "vitest";
import { markTab, openedFromDrive, openNoteTab } from "./drive-tab.ts";
import { hrefOf } from "./router.ts";

/** Loads the page as the browser says it did. */
function loaded(type: NavigationTimingType) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { type } as PerformanceNavigationTiming,
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
  markTab(false);
});

describe("A tab opened from Drive", () => {
  it("is marked as Drive's Open with opens it", () => {
    loaded("navigate");
    markTab(true);

    expect(openedFromDrive()).toBe(true);
  });

  it.each(["reload", "back_forward"] as const)(
    "keeps its mark through a %s",
    (type) => {
      loaded("navigate");
      markTab(true);
      loaded(type);
      markTab(false);

      expect(openedFromDrive()).toBe(true);
    },
  );

  it("loses its mark to an address typed in it, for good", () => {
    loaded("navigate");
    markTab(true);
    markTab(false);
    expect(openedFromDrive()).toBe(false);

    loaded("back_forward");
    markTab(false);
    expect(openedFromDrive()).toBe(false);
  });

  it("is not one that was never marked, reloaded or not", () => {
    loaded("reload");
    markTab(false);

    expect(openedFromDrive()).toBe(false);
  });

  it("counts a load the browser does not time as a new address", () => {
    loaded("navigate");
    markTab(true);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    markTab(false);

    expect(openedFromDrive()).toBe(false);
  });

  it("is not shared with other tabs", () => {
    loaded("navigate");
    markTab(true);

    expect(localStorage.length).toBe(0);
  });

  it("keeps its mode for the page's life where the browser keeps nothing", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    }
    loaded("navigate");
    markTab(true);
    expect(openedFromDrive()).toBe(true);

    loaded("reload");
    markTab(false);
    expect(openedFromDrive()).toBe(false);
  });
});

describe("A link to another note, in a tab opened from Drive", () => {
  const NOTE = hrefOf({ name: "file", file: { id: "note-b" } });

  function fromDrive() {
    loaded("navigate");
    markTab(true);
    history.replaceState(
      null,
      "",
      hrefOf({ name: "file", file: { id: "note-a" } }),
    );
  }

  it("opens it in a new tab that keeps this one as its opener", () => {
    fromDrive();
    const open = vi.spyOn(window, "open").mockReturnValue(window);

    expect(openNoteTab(NOTE)).toBe(true);
    expect(open).toHaveBeenCalledWith(
      new URL(NOTE, window.location.origin),
      "_blank",
    );
  });

  it("lets the new tab keep the mode once, as the browser copies the tab's storage", () => {
    fromDrive();
    const copied: Record<string, string> = {};
    vi.spyOn(window, "open").mockImplementation(() => {
      for (const key of Object.keys(sessionStorage)) {
        copied[key] = sessionStorage.getItem(key) ?? "";
      }
      return window;
    });
    openNoteTab(NOTE);
    expect(sessionStorage.length).toBe(1);

    // The new tab starts with the copy, at an address opened.
    sessionStorage.clear();
    for (const [key, value] of Object.entries(copied)) {
      sessionStorage.setItem(key, value);
    }
    markTab(false);
    expect(openedFromDrive()).toBe(true);

    markTab(false);
    expect(openedFromDrive()).toBe(false);
  });

  it("leaves no way to keep the mode when the browser fails to open the tab", () => {
    fromDrive();
    vi.spyOn(window, "open").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    expect(() => openNoteTab(NOTE)).toThrow();
    expect(sessionStorage.length).toBe(1);
  });

  it("opens it in place when the browser blocks the new tab", () => {
    fromDrive();
    vi.spyOn(window, "open").mockReturnValue(null);

    expect(openNoteTab(NOTE)).toBe(false);
  });

  it.each([
    ["a folder", hrefOf({ name: "folder", folder: { id: "folder-a" } })],
    [
      "the note shown",
      `${hrefOf({ name: "file", file: { id: "note-a" } })}#plan`,
    ],
    ["a page of another site", "https://example.com/edit?id=note-b"],
    [
      "a page of another site, without its scheme",
      "//example.com/edit?id=note-b",
    ],
    [
      "a page of another site, behind a backslash",
      "/\\example.com/edit?id=note-b",
    ],
    ["a script", "javascript:alert(1)"],
  ])("opens %s in place", (_, href) => {
    fromDrive();
    const open = vi.spyOn(window, "open");

    expect(openNoteTab(href)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens it in place in any other tab", () => {
    loaded("navigate");
    markTab(false);
    const open = vi.spyOn(window, "open");

    expect(openNoteTab(NOTE)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
