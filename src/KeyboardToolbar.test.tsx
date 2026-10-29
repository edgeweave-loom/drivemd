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
import { holdScreen, holdTouch } from "./test/screen.ts";

function open(
  text: string,
  onFollow: (href: string) => void = () => undefined,
  visual = false,
) {
  const { container } = render(
    <Editor
      initial={text}
      lineBreak={"\n"}
      visual={visual}
      onChange={() => undefined}
      onFollow={onFollow}
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
async function editing(
  text: string,
  onFollow: (href: string) => void = () => undefined,
) {
  holdTouch(true);
  const view = open(text, onFollow);
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
  scale = 1;
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

/**
 * Has an element sit `height` tall from `top()`, before its own shift, as
 * the browser lays it out.
 */
function sitAt(element: HTMLElement, top: () => number, height: number) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const shift = Number(/-?\d+/.exec(element.style.transform)?.[0] ?? 0);
    return new DOMRect(0, top() + shift, 0, height);
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

  it("turns Link to Open link in a link, which it follows", async () => {
    const onFollow = vi.fn<(href: string) => void>();
    const view = await editing("Tea at [noon](plan.md#noon).", onFollow);

    act(() => {
      view.dispatch({ selection: { anchor: 9 } });
    });
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    tap("Open link");
    expect(onFollow).toHaveBeenCalledExactlyOnceWith("plan.md#noon");
    expect(view.state.sliceDoc()).toBe("Tea at [noon](plan.md#noon).");

    act(() => {
      view.dispatch({ selection: { anchor: 2 } });
    });
    expect(screen.queryByRole("button", { name: "Open link" })).toBeNull();
    tap("Link");
    expect(view.state.sliceDoc()).toBe("Te[]()a at [noon](plan.md#noon).");
  });

  it("acts on a table's cell edited in place, without the keys of lines", async () => {
    holdTouch(true);
    const onFollow = vi.fn<(href: string) => void>();
    const text = "| Tea | [noon](plan.md) |\n| - | - |";
    const view = open(text, onFollow, true);
    const edit = (column: number) => {
      const heads = view.contentDOM.querySelectorAll("th");
      fireEvent.mouseDown(heads[column] ?? document.body);
      const element = view.contentDOM.querySelector<HTMLElement>(
        ".cm-table .cm-editor",
      );
      const cell = element && EditorView.findFromDOM(element);
      if (!cell) throw new Error("No cell's editor");
      return cell;
    };

    const cell = edit(0);
    expect(
      await screen.findByRole("toolbar", { name: "Formatting" }),
    ).toBeVisible();
    // Its cursor kept clear of the toolbar too.
    const [kept] = margins(cell);
    expect(kept?.bottom).toBe(
      Math.max(...margins(view).map((margin) => margin?.bottom ?? 0)),
    );
    expect(kept?.bottom).toBeGreaterThan(0);
    act(() => {
      cell.dispatch({ selection: { anchor: 0, head: 3 } });
    });
    tap("Bold");
    expect(view.state.sliceDoc()).toBe(
      "| **Tea** | [noon](plan.md) |\n| - | - |",
    );
    // The cell follows, its text still selected.
    expect(
      cell.state.sliceDoc(
        cell.state.selection.main.from,
        cell.state.selection.main.to,
      ),
    ).toBe("Tea");
    tap("Undo");
    expect(view.state.sliceDoc()).toBe(text);
    // Their marks would break its row.
    for (const name of ["Heading", "List", "Checkbox", "Indent", "Outdent"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }

    // From cell to cell, the toolbar stays, its keys of lines still out.
    const link = edit(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(toolbar()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Heading" })).toBeNull();
    act(() => {
      link.dispatch({ selection: { anchor: 2 } });
    });
    tap("Open link");
    expect(onFollow).toHaveBeenCalledExactlyOnceWith("plan.md");
  });

  /** Edits the cell `name` of the note's table, on a touch screen. */
  async function inTable(text: string, name: string) {
    holdTouch(true);
    const view = open(text, undefined, true);
    const cell = [...view.contentDOM.querySelectorAll("th, td")].find(
      (drawn) => drawn.textContent === name,
    );
    fireEvent.mouseDown(cell ?? document.body);
    await screen.findByRole("toolbar", { name: "Formatting" });
    const edited = () => {
      const element = view.contentDOM.querySelector<HTMLElement>(
        ".cm-table .cm-editor",
      );
      return element && EditorView.findFromDOM(element);
    };
    return { view, edited };
  }

  function keys() {
    return [...(toolbar()?.querySelectorAll("button") ?? [])].map((key) =>
      key.getAttribute("aria-label"),
    );
  }

  it("holds a table's frequent edits in its cells, after Undo and Redo, the focus staying", async () => {
    const { view, edited } = await inTable(
      "| Tea | Cups |\n| :- | - |\n| 1 | 2 |",
      "1",
    );

    expect(keys()).toEqual([
      "Undo",
      "Redo",
      "Add row below",
      "Delete row",
      "Add column to the right",
      "Delete column",
      "Align left",
      "Align center",
      "Align right",
      "Bold",
      "Link",
      "Find in note",
      "Table options",
    ]);
    // Between Undo and Redo, the rows', the columns', the alignment's and
    // the rest, keeping the focus, and the keyboard up, as the keys do.
    const rules = toolbar()?.querySelectorAll("hr") ?? [];
    expect(rules).toHaveLength(4);
    for (const rule of rules) expect(fireEvent.mouseDown(rule)).toBe(false);
    // The column's own alignment pressed.
    const pressed = () =>
      ["Align left", "Align center", "Align right"].map((name) =>
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      );
    expect(pressed()).toEqual(["true", "false", "false"]);
    const key = screen.getByRole("button", { name: "Align center" });
    // It keeps the focus, and the keyboard up.
    expect(fireEvent.mouseDown(key)).toBe(false);
    tap("Align center");
    expect(view.state.sliceDoc()).toBe(
      "| Tea | Cups |\n| :-: | - |\n| 1 | 2 |",
    );
    expect(pressed()).toEqual(["false", "true", "false"]);
    expect(edited()?.hasFocus).toBe(true);
    const host = () =>
      view.contentDOM.querySelector<HTMLElement>(".cm-cell-edited");
    expect(host()?.style.textAlign).toBe("center");
    tap("Undo");
    expect(view.state.sliceDoc()).toBe("| Tea | Cups |\n| :- | - |\n| 1 | 2 |");
    expect(pressed()).toEqual(["true", "false", "false"]);
    // The cell edited aligned as its column again, as the others.
    expect(host()?.style.textAlign).toBe("left");

    tap("Add row below");
    expect(view.state.sliceDoc()).toBe(
      "| Tea | Cups |\n| :- | - |\n| 1 | 2 |\n|  |  |",
    );
    expect(edited()?.state.sliceDoc()).toBe("");
    expect(edited()?.hasFocus).toBe(true);
    tap("Delete row");
    expect(view.state.sliceDoc()).toBe("| Tea | Cups |\n| :- | - |\n| 1 | 2 |");
    expect(edited()?.state.sliceDoc()).toBe("1");
    tap("Add column to the right");
    expect(view.state.sliceDoc()).toBe(
      "| Tea |  | Cups |\n| :- | --- | - |\n| 1 |  | 2 |",
    );
    expect(edited()?.hasFocus).toBe(true);
    tap("Delete column");
    expect(view.state.sliceDoc()).toBe("| Tea | Cups |\n| :- | - |\n| 1 | 2 |");
    expect(edited()?.state.sliceDoc()).toBe("2");
    expect(edited()?.hasFocus).toBe(true);
    // The cell's column's alignment, as it moved.
    expect(pressed()).toEqual(["false", "false", "false"]);
  });

  it("keeps a table's keys off where their edits do not apply", async () => {
    const { view, edited } = await inTable("| Tea |\n| - |\n| 1 |", "Tea");
    const off = () =>
      [...(toolbar()?.querySelectorAll('[aria-disabled="true"]') ?? [])].map(
        (key) => key.getAttribute("aria-label"),
      );

    expect(off()).toEqual(["Delete row", "Delete column"]);
    // Still keeping the focus, and the keyboard up.
    const key = screen.getByRole("button", { name: "Delete row" });
    expect(fireEvent.mouseDown(key)).toBe(false);
    tap("Delete row");
    tap("Delete column");
    expect(view.state.sliceDoc()).toBe("| Tea |\n| - |\n| 1 |");
    expect(edited()?.hasFocus).toBe(true);
    // None pressed in a column without its alignment.
    expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Anew in another cell of the column, its alignment the same.
    fireEvent.mouseDown(view.contentDOM.querySelector("td") ?? document.body);
    await waitFor(() => {
      expect(off()).toEqual(["Delete column"]);
    });
    // And gone with the cell, as the note takes the focus.
    act(() => {
      view.focus();
    });
    await waitFor(() => {
      expect(keys()).toContain("Heading");
    });
    expect(keys()).not.toContain("Table options");
  });

  it("holds a table's other edits in the menu of its Table options key, above it, the focus staying", async () => {
    const { view, edited } = await inTable(
      "| Tea | Cups |\n| - | - |\n| 1 | 2 |",
      "1",
    );

    const key = screen.getByRole("button", { name: "Table options" });
    expect(key).toHaveAttribute("aria-haspopup", "menu");
    expect(fireEvent.mouseDown(key)).toBe(false);
    tap("Table options");
    const menu = screen.getByRole("menu", { name: "Table" });
    expect(
      [...menu.querySelectorAll('[role^="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "Add row above",
      "Move row up",
      "Move row down",
      "Add column to the left",
      "Move column left",
      "Move column right",
    ]);
    expect(menu.querySelectorAll("hr")).toHaveLength(1);
    const item = screen.getByRole("menuitem", {
      name: "Add column to the left",
    });
    expect(item).not.toHaveFocus();
    expect(fireEvent.mouseDown(item)).toBe(false);
    fireEvent.click(item);

    expect(view.state.sliceDoc()).toBe(
      "|  | Tea | Cups |\n| --- | - | - |\n|  | 1 | 2 |",
    );
    expect(menu).not.toBeVisible();
    expect(edited()?.state.sliceDoc()).toBe("");
    expect(edited()?.hasFocus).toBe(true);
    tap("Table options");
    tap("Table options");
    expect(menu).not.toBeVisible();
    expect(edited()?.hasFocus).toBe(true);

    // A right-click's holds them all.
    const drawn = [...view.contentDOM.querySelectorAll("td")].find(
      (cell) => cell.textContent === "2",
    );
    expect(fireEvent.contextMenu(drawn ?? document.body)).toBe(false);
    expect(menu.querySelectorAll('[role^="menuitem"]')).toHaveLength(13);
    act(() => {
      menu.hidePopover();
    });

    // Its cell left, it closes, its items being that cell's.
    tap("Table options");
    expect(menu).toBeVisible();
    fireEvent.mouseDown(view.contentDOM.querySelector("th") ?? document.body);
    expect(menu).not.toBeVisible();
  });

  it("keeps a table's keys to its cells", async () => {
    await editing("| Tea |\n| - |");

    expect(screen.queryByRole("button", { name: "Table options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add row below" })).toBeNull();
    expect(screen.getByRole("button", { name: "Indent" })).toBeVisible();
  });

  it("finds text in the note, its field taking the focus within the tap", async () => {
    const view = await editing("tea");

    tap("Find in note");

    expect(searchPanelOpen(view.state)).toBe(true);
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveFocus();
  });

  it("keeps the app bar, which a phone's Find in note takes, in view while it is open", async () => {
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    const appBar = document.body.appendChild(document.createElement("header"));
    appBar.className = "bar";
    let top = 0;
    sitAt(appBar, () => top, 56);
    await editing("tea");

    tap("Find in note");
    await waitFor(() => {
      expect(toolbar()).toBeNull();
    });
    // iOS pans the page away from the bar.
    top = -120;
    act(() => {
      viewport.show(400);
    });

    expect(appBar.style.transform).toBe("translateY(120px)");
    appBar.remove();
  });

  it("keeps the app bar and Find in note's bar under it in view on a tablet", async () => {
    holdScreen("tablet");
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    const appBar = document.body.appendChild(document.createElement("header"));
    appBar.className = "bar";
    let top = 0;
    sitAt(appBar, () => top, 56);
    await editing("tea");

    tap("Find in note");
    const findBar = screen.getByRole("search", { name: "Find in note" });
    sitAt(findBar, () => top + 56, 56);
    // Its field has the focus, and iOS pans the page away from the bar.
    await waitFor(() => {
      expect(toolbar()).toBeNull();
    });
    top = -120;
    act(() => {
      viewport.show(400);
    });

    expect(appBar.style.transform).toBe("translateY(120px)");
    expect(findBar.style.transform).toBe("translateY(120px)");
    appBar.remove();
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

  it("keeps the cursor clear of it where a keyboard pans the page rather than shrinking it", async () => {
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    const view = await editing("tea");
    layOut(screen.getByRole("toolbar", { name: "Formatting" }), () => 797);

    // Measured in the Android Emulator: Samsung Internet's first Gboard
    // leaves the page 797 pixels tall, and shows 485 of them from 244 down,
    // where CodeMirror takes the window for the page's first 485.
    act(() => {
      viewport.show(485, 244);
    });

    expect(margins(view)).toContainEqual({ top: 0, bottom: -196 });
  });

  it("scrolls to the cursor once the keyboard has come over it, unless scrolled away", async () => {
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    const view = await editing("tea");
    // Under the keyboard, as Chrome on Android leaves the cursor that a tap
    // brought the keyboard up over.
    let cursor = 600;
    vi.spyOn(view, "coordsAtPos").mockImplementation(() => ({
      left: 0,
      right: 0,
      top: cursor,
      bottom: cursor + 26,
    }));
    const scrolls: number[] = [];
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          for (const { effects } of update.transactions) {
            // Not the listener's own.
            if (!effects.some((effect) => effect.is(StateEffect.appendConfig)))
              scrolls.push(effects.length);
          }
        }),
      ),
    });

    act(() => {
      viewport.show(500);
    });
    await waitFor(() => {
      expect(scrolls).toEqual([1]);
    });

    // As Safari folds its bars while the page scrolls far from the cursor.
    cursor = -2000;
    act(() => {
      viewport.show(540);
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(scrolls).toEqual([1]);
  });

  it("scrolls to a table's cell edited in place once the keyboard has come over it", async () => {
    const viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    holdTouch(true);
    const view = open("| Tea |\n| - |", undefined, true);
    fireEvent.mouseDown(view.contentDOM.querySelector("th") ?? document.body);
    const element = view.contentDOM.querySelector<HTMLElement>(
      ".cm-table .cm-editor",
    );
    const cell = element && EditorView.findFromDOM(element);
    if (!cell) throw new Error("No cell's editor");
    await screen.findByRole("toolbar", { name: "Formatting" });
    // The cell's cursor under the keyboard, wherever the note's would be.
    vi.spyOn(cell, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 0,
      top: 600,
      bottom: 626,
    });
    vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
    const scrolls: number[] = [];
    cell.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          for (const { effects } of update.transactions) {
            if (!effects.some((effect) => effect.is(StateEffect.appendConfig)))
              scrolls.push(effects.length);
          }
        }),
      ),
    });

    act(() => {
      viewport.show(500);
    });
    await waitFor(() => {
      expect(scrolls).toEqual([1]);
    });
  });

  it.each([
    { what: "under the toolbar", top: 460 },
    // As the iPad left the line the tap placed, the keyboard up.
    { what: "under the keyboard", top: 600 },
  ])(
    "scrolls to the cursor that the tap bringing it placed, $what",
    async ({ top }) => {
      const viewport = new Viewport();
      // The keyboard already up, as iOS may bring it before the toolbar shows,
      // or keep it from Find in note's field.
      viewport.height = 500;
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
      const view = await editing("tea");
      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        left: 0,
        right: 0,
        top,
        bottom: top + 26,
      });
      const scrolls: number[] = [];
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.updateListener.of((update) => {
            for (const { effects } of update.transactions) {
              // Not the listener's own.
              if (
                !effects.some((effect) => effect.is(StateEffect.appendConfig))
              )
                scrolls.push(effects.length);
            }
          }),
        ),
      });

      await waitFor(() => {
        expect(scrolls).toEqual([1]);
      });
    },
  );

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
