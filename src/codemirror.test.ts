import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountIn, THEME } from "./codemirror.ts";
import { installScreen } from "./test/screen.ts";

const DARK = "(prefers-color-scheme: dark)";

let dark = false;
const listeners = new Set<() => void>();

/** Has the made-up system turn dark or light, as its settings would. */
function turn(next: boolean) {
  dark = next;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  dark = false;
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return query === DARK && dark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        if (query === DARK) listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
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

describe("THEME", () => {
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
    expect(listeners.size).toBe(0);
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
