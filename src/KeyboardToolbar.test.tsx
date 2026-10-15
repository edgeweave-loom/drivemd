import { searchPanelOpen } from "@codemirror/search";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor.tsx";
import { holdTouch } from "./test/screen.ts";

function open(text: string) {
  const { container } = render(
    <Editor
      initial={text}
      lineBreak={"\n"}
      onChange={() => undefined}
      onFollow={() => undefined}
    />,
  );
  const element = container
    .querySelector(".editor")
    ?.shadowRoot?.querySelector<HTMLElement>(".cm-editor");
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error("No editor");
  return view;
}

/** Opens the editor on a touch screen and gives it the focus. */
async function editing(text: string) {
  holdTouch(true);
  const view = open(text);
  act(() => {
    view.focus();
  });
  await screen.findByRole("toolbar", { name: "Formatting" });
  return view;
}

function toolbar() {
  return screen.queryByRole("toolbar", { name: "Formatting" });
}

function tap(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** The margins the editor keeps around the cursor when it scrolls. */
function margins(view: EditorView) {
  return view.state.facet(EditorView.scrollMargins).map((of) => of(view));
}

/**
 * A screen whose keyboard leaves `height` of the page's 800 pixels, from
 * `pageTop` down, where the page is scrolled to 0. `offsetTop` is what iOS
 * says besides, which may be off.
 */
class Viewport extends EventTarget {
  height = 800;
  pageTop = 0;
  offsetTop = 0;
  show(height: number, pageTop = 0, offsetTop = pageTop) {
    this.height = height;
    this.pageTop = pageTop;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event(pageTop === 0 ? "resize" : "scroll"));
  }
}

/**
 * Has the toolbar sit with its bottom at `bottom()`, before its lift, as
 * the browser lays it out.
 */
function layOut(bar: HTMLElement, bottom: () => number) {
  vi.spyOn(bar, "getBoundingClientRect").mockImplementation(() => {
    const lift = Number(/-?\d+/.exec(bar.style.transform)?.[0] ?? 0);
    return new DOMRect(0, bottom() + lift - 48, 0, 48);
  });
}

describe("the keyboard toolbar", () => {
  beforeEach(() => {
    // jsdom names Apple as its vendor, so CodeMirror reads the selection in
    // a shadow root as Safari needs, through a command jsdom lacks.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("shows on a touch screen while the editor has the focus", async () => {
    holdTouch(true);
    const view = open("tea");
    expect(toolbar()).toBeNull();

    act(() => {
      view.focus();
    });
    expect(
      await screen.findByRole("toolbar", { name: "Formatting" }),
    ).toBeVisible();

    act(() => {
      view.contentDOM.blur();
    });
    await waitFor(() => {
      expect(toolbar()).toBeNull();
    });
  });

  it("never shows with a mouse, whose keyboard has its own keys", async () => {
    const view = open("tea");
    act(() => {
      view.focus();
    });

    // The editor has taken in the focus once it shows it.
    await waitFor(() => {
      expect(view.dom).toHaveClass("cm-focused");
    });
    expect(toolbar()).toBeNull();
  });

  it.each([
    ["Heading", "tea", "# tea"],
    ["Bold", "tea", "****tea"],
    ["List", "tea", "- tea"],
    ["Checkbox", "tea", "- [ ] tea"],
    ["Link", "tea", "[]()tea"],
    ["Indent", "tea", "  tea"],
    ["Outdent", "  tea", "tea"],
  ])("%s formats the line", async (name, before, after) => {
    const view = await editing(before);

    tap(name);

    expect(view.state.sliceDoc()).toBe(after);
  });

  it("undoes and redoes the edits", async () => {
    const view = await editing("tea");
    view.dispatch({ changes: { from: 3, insert: "s" }, userEvent: "input" });

    tap("Undo");
    expect(view.state.sliceDoc()).toBe("tea");
    tap("Redo");
    expect(view.state.sliceDoc()).toBe("teas");
  });

  it("finds text in the note", async () => {
    const view = await editing("tea");

    tap("Find in note");

    expect(searchPanelOpen(view.state)).toBe(true);
  });

  it("leaves the focus, and the keyboard, with the editor", async () => {
    await editing("tea");
    const button = screen.getByRole("button", { name: "Bold" });

    // A false answer means the browser's default, the focus moving to the
    // button, was prevented. WebKit drops the whole tap, click included,
    // when a touch's pointerdown is.
    expect(fireEvent.mouseDown(button)).toBe(false);
    expect(fireEvent.pointerDown(button)).toBe(true);
  });

  it("sits on top of the keyboard as it comes, goes and scrolls", async () => {
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    await editing("tea");
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    let bottom = 800;
    layOut(bar, () => bottom);

    act(() => {
      viewport.show(500);
    });
    expect(bar.style.transform).toBe("translateY(-300px)");
    act(() => {
      viewport.show(500, 100);
    });
    expect(bar.style.transform).toBe("translateY(-200px)");
    act(() => {
      viewport.show(800);
    });
    expect(bar.style.transform).toBe("translateY(0px)");
    // As Safari bounces past the page's end.
    act(() => {
      viewport.show(800, 50);
    });
    expect(bar.style.transform).toBe("translateY(0px)");

    // As the Home Screen app lays the page out once lines are deleted at the
    // note's end, measured in the iOS simulator.
    bottom = 475;
    act(() => {
      viewport.show(424, 0, 318);
    });
    expect(bar.style.transform).toBe("translateY(-51px)");
  });

  it("keeps the cursor clear of it and of the app bar while it shows", async () => {
    const appBar = document.body.appendChild(document.createElement("header"));
    appBar.className = "bar";
    vi.spyOn(appBar, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 0, 56),
    );
    holdTouch(true);
    const view = open("tea");
    expect(margins(view)).toContainEqual(null);

    act(() => {
      view.focus();
    });
    await screen.findByRole("toolbar", { name: "Formatting" });

    expect(margins(view)).toContainEqual({ top: 56, bottom: 48 });
    appBar.remove();
  });

  it.each([
    {
      touch: true,
      what: "scrolls to the cursor a tap places, which it may cover",
    },
    { touch: false, what: "leaves the scrolling to the browser with a mouse" },
  ])("$what", async ({ touch }) => {
    holdTouch(touch);
    const view = open("tea\nfor\ntwo");
    act(() => {
      view.focus();
    });
    if (touch) await screen.findByRole("toolbar", { name: "Formatting" });
    const scrolls: boolean[] = [];
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          for (const { selection, effects } of update.transactions) {
            if (selection) scrolls.push(effects.length > 0);
          }
        }),
      ),
    });

    view.dispatch({ selection: { anchor: 5 }, userEvent: "select" });

    expect(scrolls).toEqual([touch]);
  });
});
