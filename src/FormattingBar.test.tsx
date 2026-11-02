import { syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor.tsx";
import { holdTouch } from "./test/screen.ts";

/** Opens the editor, its formatting toolbar's place over it. */
function open(text: string, visual = false) {
  const slot = document.createElement("div");
  document.body.append(slot);
  const { container } = render(
    <Editor
      initial={text}
      lineBreak={"\n"}
      visual={visual}
      onChange={() => undefined}
      onFollow={() => undefined}
      formatSlot={slot}
    />,
  );
  const element = container
    .querySelector(".editor")
    ?.shadowRoot?.querySelector<HTMLElement>(".cm-editor");
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error("No editor");
  return view;
}

function toolbar() {
  return screen.getByRole("toolbar", { name: "Format" });
}

function names() {
  return within(toolbar())
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("the formatting toolbar", () => {
  beforeEach(() => {
    // jsdom names Apple as its vendor, so CodeMirror reads the selection in
    // a shadow root as Safari needs, through a command jsdom lacks.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    // Nor does it measure text, which CodeMirror does in the frame after
    // a table's edit.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, "getClientRects");
  });

  it("shows over the note with a mouse, each button named with its key", () => {
    open("tea");

    expect(names()).toEqual([
      "Find in note",
      "Undo",
      "Redo",
      "Style",
      "Bold",
      "Italic",
      "Strikethrough",
      "Code",
      "Link",
      "Bulleted list",
      "Numbered list",
      "Checkbox",
      "Quote",
      "Outdent",
      "Indent",
    ]);
    const bold = within(toolbar()).getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("title", "Bold (Ctrl+B)");
    expect(bold).toHaveAttribute("aria-keyshortcuts", "Control+B");
    expect(
      within(toolbar()).getByRole("button", { name: "Numbered list" }),
    ).toHaveAttribute("title", "Numbered list (Ctrl+Shift+7)");
    expect(
      within(toolbar()).getByRole("button", { name: "Quote" }),
    ).toHaveAttribute("title", "Quote");
    // Pressed or not, as the formatting where the cursor is.
    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(
      within(toolbar()).getByRole("button", { name: "Link" }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("leaves a mouse's selections to scroll as CodeMirror scrolls them", () => {
    const view = open("Some tea.\n\nCups.");
    const scrolls: number[] = [];
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          for (const { selection, effects } of update.transactions) {
            if (selection) scrolls.push(effects.length);
          }
        }),
      ),
    });

    // Long after any finger, as a drag selects again every 50 ms: a click
    // never lands under the toolbar.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60_000);
      view.dispatch({ selection: { anchor: 12 }, userEvent: "select.pointer" });
    } finally {
      vi.useRealTimers();
    }

    expect(scrolls).toEqual([0]);
  });

  it("shows none on a touch screen, which has the keyboard toolbar", () => {
    holdTouch(true);
    open("tea");

    expect(screen.queryByRole("toolbar", { name: "Format" })).toBeNull();
  });

  it("formats the text from a click, which leaves the focus in it", () => {
    const view = open("tea");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });
    const quote = within(toolbar()).getByRole("button", { name: "Quote" });

    // The press keeps the focus where it is.
    expect(fireEvent.mouseDown(quote)).toBe(false);
    fireEvent.click(quote);

    expect(view.state.sliceDoc()).toBe("> tea");
    expect(view.hasFocus).toBe(true);
  });

  it("is reached from Alt+F10, moved through with the arrows, and left with Escape", () => {
    const view = open("tea");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });

    fireEvent.keyDown(view.contentDOM, { key: "F10", altKey: true });
    const find = within(toolbar()).getByRole("button", {
      name: "Find in note",
    });
    expect(find).toHaveFocus();
    // Tab stops at it alone.
    expect(find).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(find, { key: "ArrowLeft" });
    const indent = within(toolbar()).getByRole("button", { name: "Indent" });
    expect(indent).toHaveFocus();
    expect(indent).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(indent, { key: "Home" });
    fireEvent.keyDown(find, { key: "ArrowRight" });
    expect(
      within(toolbar()).getByRole("button", { name: "Undo" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? toolbar(), { key: "Escape" });
    expect(view.hasFocus).toBe(true);
  });

  it("gives the focus back to the text once a button is pressed from the keyboard", () => {
    const view = open("tea");
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });
    const bold = within(toolbar()).getByRole("button", { name: "Bold" });
    act(() => {
      bold.focus();
    });

    fireEvent.click(bold);

    expect(view.state.sliceDoc()).toBe("**tea**");
    expect(view.hasFocus).toBe(true);
  });

  it("shows the line's style, and sets another from its menu, with its key", () => {
    const view = open("## tea");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 6 } });
    });
    const style = within(toolbar()).getByRole("button", { name: "Style" });
    expect(style).toHaveTextContent("Heading 2");

    fireEvent.click(style);
    const menu = screen.getByRole("menu", { name: "Style" });
    const checked = within(menu).getByRole("menuitemradio", {
      checked: true,
    });
    expect(checked).toHaveTextContent("Heading 2");
    expect(checked).toHaveFocus();
    const text = within(menu).getByRole("menuitemradio", {
      name: "Normal text",
    });
    expect(text).toHaveAttribute("aria-keyshortcuts", "Control+Alt+0");
    expect(text).toHaveTextContent("Ctrl+Alt+0");
    fireEvent.click(text);

    expect(view.state.sliceDoc()).toBe("tea");
    expect(style).toHaveTextContent("Normal text");
    expect(view.hasFocus).toBe(true);
  });

  it("presses the buttons of the formatting around the cursor", () => {
    const view = open("- **tea** and _cups_");
    const pressed = () =>
      within(toolbar())
        .getAllByRole("button", { pressed: true })
        .map((button) => button.getAttribute("aria-label"));
    act(() => {
      view.dispatch({ selection: { anchor: 5 } });
    });
    expect(pressed()).toEqual(["Bold", "Bulleted list"]);

    act(() => {
      view.dispatch({ selection: { anchor: 17 } });
    });
    expect(pressed()).toEqual(["Italic", "Bulleted list"]);
  });

  /** Edits the table cell drawn as `name`, from a click. */
  async function editCell(view: EditorView, name: string) {
    await waitFor(() => {
      expect(syntaxTreeAvailable(view.state)).toBe(true);
    });
    const drawn = [...view.contentDOM.querySelectorAll("th, td")].find(
      (cell) => cell.textContent === name,
    );
    fireEvent.mouseDown(drawn ?? document.body);
    const cell = EditorView.findFromDOM(
      view.contentDOM.querySelector<HTMLElement>(".cm-table .cm-editor") ??
        document.body,
    );
    if (!cell) throw new Error("No cell's editor");
    return cell;
  }

  it("trades the buttons of lines for the table's in a cell, whose text it formats", async () => {
    const view = open("| Tea | Cups |\n| - | - |", true);
    const cell = await editCell(view, "Tea");
    act(() => {
      cell.dispatch({ selection: { anchor: 0, head: 3 } });
    });

    await waitFor(() => {
      expect(names()).toEqual([
        "Find in note",
        "Undo",
        "Redo",
        "Bold",
        "Italic",
        "Strikethrough",
        "Code",
        "Link",
        "Add row below",
        "Delete row",
        "Add column to the right",
        "Delete column",
        "Align left",
        "Align center",
        "Align right",
        "Table",
      ]);
    });
    // The head's row is never deleted.
    expect(
      within(toolbar()).getByRole("button", { name: "Delete row" }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Bold" }));
    expect(view.state.sliceDoc()).toBe("| **Tea** | Cups |\n| - | - |");
    expect(cell.hasFocus).toBe(true);

    const center = within(toolbar()).getByRole("button", {
      name: "Align center",
    });
    expect(fireEvent.mouseDown(center)).toBe(false);
    fireEvent.click(center);
    expect(view.state.sliceDoc()).toBe("| **Tea** | Cups |\n| :-: | - |");
    await waitFor(() => {
      expect(center).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("opens the table's menu below its Table button, with the edits it lacks", async () => {
    const view = open("| Tea | Cups |\n| - | - |\n| 1 | 2 |", true);
    const cell = await editCell(view, "1");

    fireEvent.click(
      await within(toolbar()).findByRole("button", { name: "Table" }),
    );
    const menu = screen.getByRole("menu", { name: "Table" });
    expect(menu).toHaveClass("below");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Insert line break",
      "Add row above",
      "Move row up",
      "Move row down",
      "Add column to the left",
      "Move column left",
      "Move column right",
    ]);
    const lineBreak = within(menu).getByRole("menuitem", {
      name: "Insert line break",
    });
    expect(lineBreak).toHaveAttribute("aria-keyshortcuts", "Shift+Enter");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Add row above" }),
    );

    expect(view.state.sliceDoc()).toBe(
      "| Tea | Cups |\n| - | - |\n|  |  |\n| 1 | 2 |",
    );
    // The row added edited, its cell focused.
    const edited = EditorView.findFromDOM(
      view.contentDOM.querySelector<HTMLElement>(".cm-table .cm-editor") ??
        document.body,
    );
    expect(edited).not.toBe(cell);
    expect(edited?.hasFocus).toBe(true);
  });

  it("keeps a cell edited while the keyboard is in the toolbar, then gives it the focus back", async () => {
    const view = open("| Tea | Cups |\n| - | - |\n| 1 | 2 |", true);
    const cell = await editCell(view, "1");
    act(() => {
      cell.focus();
    });

    fireEvent.keyDown(cell.contentDOM, { key: "F10", altKey: true });
    const find = within(toolbar()).getByRole("button", {
      name: "Find in note",
    });
    expect(find).toHaveFocus();
    await act(async () => {
      await Promise.resolve();
    });
    // Still edited, its table buttons still there.
    expect(
      within(toolbar()).getByRole("button", { name: "Table" }),
    ).toBeVisible();
    fireEvent.keyDown(find, { key: "Escape" });

    expect(cell.hasFocus).toBe(true);
  });
});
