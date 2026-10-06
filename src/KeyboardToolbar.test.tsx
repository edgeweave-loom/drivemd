import { searchPanelOpen } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

/** A screen whose keyboard leaves `height` of the page's 800 pixels. */
class Viewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  show(height: number, offsetTop = 0) {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event(offsetTop === 0 ? "resize" : "scroll"));
  }
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
    Reflect.deleteProperty(window, "innerHeight");
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
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    await editing("tea");
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(bar.style.transform).toBe("translateY(0px)");

    act(() => {
      viewport.show(500);
    });
    // React may listen only after the toolbar shows, and then reads where
    // the keyboard is.
    await waitFor(() => {
      expect(bar.style.transform).toBe("translateY(-300px)");
    });
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
  });

  it("keeps the cursor clear of it while it shows", async () => {
    holdTouch(true);
    const view = open("tea");
    expect(margins(view)).not.toContainEqual({ bottom: 48 });

    act(() => {
      view.focus();
    });
    await screen.findByRole("toolbar", { name: "Formatting" });

    expect(margins(view)).toContainEqual({ bottom: 48 });
  });
});
