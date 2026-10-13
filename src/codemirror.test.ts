import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountIn, THEME } from "./codemirror.ts";
import { installScreen } from "./test/screen.ts";

let dark = false;
let touch = true;
// Each query's listeners, by the query.
const listeners = new Map<string, Set<() => void>>();

/** Tells the listeners of each query that names the feature that changed. */
function changed(feature: string) {
  for (const [query, each] of listeners) {
    if (query.includes(feature)) for (const listener of each) listener();
  }
}

/** Has the made-up system turn dark or light, as its settings would. */
function turn(next: boolean) {
  dark = next;
  changed("prefers-color-scheme");
}

/** Has the made-up screen take touch or a mouse, as a convertible would. */
function point(coarse: boolean) {
  touch = coarse;
  changed("pointer");
}

/** Whether the made-up screen matches a query of features joined by "and". */
function matches(query: string) {
  const features: Record<string, boolean> = {
    "(prefers-color-scheme: dark)": dark,
    "(prefers-color-scheme: light)": !dark,
    "(pointer: coarse)": touch,
  };
  return query.split(" and ").every((feature) => features[feature] === true);
}

beforeEach(() => {
  dark = false;
  touch = true;
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return matches(query);
      },
      addEventListener: (_type: string, listener: () => void) => {
        const each = listeners.get(query) ?? new Set();
        listeners.set(query, each.add(listener));
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.get(query)?.delete(listener);
      },
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  installScreen();
  listeners.clear();
});

function mount() {
  return mountIn(
    document.createElement("div"),
    EditorState.create({ extensions: THEME }),
  );
}

/** Whether CodeMirror styles the view, its packages' styles too, as dark. */
function isDark(view: EditorView) {
  return view.state.facet(EditorView.darkTheme);
}

describe("THEME, on a touch screen", () => {
  it("tells CodeMirror the theme is dark when the system's is", () => {
    dark = true;
    const view = mount();
    expect(isDark(view)).toBe(true);
    view.destroy();
  });

  it("tells CodeMirror the theme is light when the system's is", () => {
    const view = mount();
    expect(isDark(view)).toBe(false);
    view.destroy();
  });

  it("follows the system's theme as it changes", () => {
    const view = mount();
    turn(true);
    expect(isDark(view)).toBe(true);
    turn(false);
    expect(isDark(view)).toBe(false);
    view.destroy();
  });

  it("stops following once the view goes", () => {
    const view = mount();
    view.destroy();
    for (const each of listeners.values()) expect(each.size).toBe(0);
  });
});

describe("THEME, on a computer", () => {
  beforeEach(() => {
    touch = false;
  });

  it("keeps CodeMirror's theme light, dark as the system's may be", () => {
    dark = true;
    const view = mount();
    expect(isDark(view)).toBe(false);
    view.destroy();
  });

  it("keeps it light as the system's theme changes", () => {
    const view = mount();
    turn(true);
    expect(isDark(view)).toBe(false);
    view.destroy();
  });

  it("follows the system's theme once the screen takes touch", () => {
    dark = true;
    const view = mount();
    point(true);
    expect(isDark(view)).toBe(true);
    point(false);
    expect(isDark(view)).toBe(false);
    view.destroy();
  });
});

describe("THEME, as fonts load", () => {
  it("measures the view again once a font has loaded", () => {
    const view = mount();
    const measuring = vi.spyOn(view, "requestMeasure");
    document.fonts.dispatchEvent(new Event("loadingdone"));
    expect(measuring).toHaveBeenCalled();
    view.destroy();
    measuring.mockClear();
    document.fonts.dispatchEvent(new Event("loadingdone"));
    expect(measuring).not.toHaveBeenCalled();
  });
});
