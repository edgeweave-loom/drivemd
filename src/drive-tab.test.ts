import { afterEach, describe, expect, it, vi } from "vitest";
import { markTab, openedFromDrive, openNoteTab } from "./drive-tab.ts";
import { hrefOf } from "./router.ts";

/** Loads the page as the browser says it did. */
function loaded(type: NavigationTimingType) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { type } as PerformanceNavigationTiming,
  ]);
}

const NOTE = hrefOf({ name: "file", file: { id: "note-b" } });

/** Shows note-a in a tab that Drive opened. */
function fromDrive() {
  loaded("navigate");
  markTab(true);
  history.replaceState(
    null,
    "",
    hrefOf({ name: "file", file: { id: "note-a" } }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.name = "";
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
  it("opens it in a new tab that keeps this one as its opener", () => {
    fromDrive();
    const open = vi.spyOn(window, "open").mockReturnValue(window);

    expect(openNoteTab(NOTE)).toBe(true);
    expect(open).toHaveBeenCalledWith(
      new URL(NOTE, window.location.origin),
      expect.stringMatching(/^drivemd\.note\./),
    );
  });

  it("opens a new tab for each, rather than one a link opened before", () => {
    fromDrive();
    const open = vi.spyOn(window, "open").mockReturnValue(window);
    openNoteTab(NOTE);
    openNoteTab(NOTE);

    const [first, second] = open.mock.calls.map(([, target]) => target);
    expect(first).not.toBe(second);
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

describe("The tab a link opens from a tab opened from Drive", () => {
  /** Starts the page in the tab that openNoteTab opens, as the browser does. */
  function openedByLink() {
    fromDrive();
    let name = "";
    vi.spyOn(window, "open").mockImplementation((_, target) => {
      name = target ?? "";
      return window;
    });
    openNoteTab(NOTE);
    // The browser copied nothing of the tab's storage into the new one.
    sessionStorage.clear();
    window.name = name;
  }

  it("keeps the mode, though the browser copied nothing for it", () => {
    openedByLink();
    markTab(false);

    expect(openedFromDrive()).toBe(true);
  });

  it.each(["reload", "back_forward"] as const)(
    "keeps the mode through a %s, once its name is gone",
    (type) => {
      openedByLink();
      markTab(false);
      loaded(type);
      markTab(false);

      expect(openedFromDrive()).toBe(true);
    },
  );

  it("loses the mode to an address typed in it", () => {
    openedByLink();
    markTab(false);
    markTab(false);

    expect(openedFromDrive()).toBe(false);
    expect(window.name).toBe("");
  });

  it("leaves a name that no link of the app gave it", () => {
    loaded("navigate");
    window.name = "elsewhere";
    markTab(false);

    expect(openedFromDrive()).toBe(false);
    expect(window.name).toBe("elsewhere");
  });
});
