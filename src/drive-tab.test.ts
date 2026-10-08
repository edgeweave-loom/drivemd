import { afterEach, describe, expect, it, vi } from "vitest";
import { markTab, openedFromDrive } from "./drive-tab.ts";

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
