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
function open(text: string, visual = false, vault = false) {
  const slot = document.createElement("div");
  document.body.append(slot);
  const { container } = render(
    <Editor
      initial={text}
      lineBreak={"\n"}
      visual={visual}
      vault={vault}
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
      "Insert table",
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

  it("turns Style off in code, as text, and Checkbox off on a heading", () => {
    const view = open("```\n## code\n```\n- ## tea");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 6 } });
    });
    const style = within(toolbar()).getByRole("button", { name: "Style" });
    const checkbox = within(toolbar()).getByRole("button", {
      name: "Checkbox",
    });
    expect(style).toHaveTextContent("Normal text");
    expect(style).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(style);
    expect(screen.queryByRole("menu", { name: "Style" })).toBeNull();
    expect(checkbox).toHaveAttribute("aria-disabled", "true");

    act(() => {
      view.dispatch({ selection: { anchor: 23 } });
    });
    expect(style).toHaveTextContent("Heading 2");
    expect(style).not.toHaveAttribute("aria-disabled");
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(checkbox);
    expect(view.state.sliceDoc()).toBe("```\n## code\n```\n- ## tea");
  });

  it("makes a callout from Quote's menu in a vault's note, its format checked", () => {
    const view = open("> [!faq] tea", false, true);
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 12 } });
    });
    expect(names().slice(12, 15)).toEqual([
      "Quote",
      "Quote format",
      "Insert table",
    ]);
    const type = within(toolbar()).getByRole("button", {
      name: "Quote format",
    });
    expect(type).toHaveAttribute("aria-haspopup", "menu");
    expect(type).toHaveAttribute("title", "Quote format");

    fireEvent.click(type);
    const menu = screen.getByRole("menu", { name: "Quote format" });
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.textContent)).toEqual([
      "Plain quote",
      "Note",
      "Abstract",
      "Info",
      "Todo",
      "Tip",
      "Success",
      "Question",
      "Warning",
      "Failure",
      "Danger",
      "Bug",
      "Example",
      "Quote",
    ]);
    // Written as an alias, it shows as its type.
    const checked = within(menu).getByRole("menuitemcheckbox", {
      checked: true,
    });
    expect(checked).toHaveTextContent("Question");
    expect(checked).toHaveFocus();
    const warning = within(menu).getByRole("menuitemcheckbox", {
      name: "Warning",
    });
    expect(warning.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "lucide-triangle-alert",
    );
    expect(
      within(menu)
        .getByRole("menuitemcheckbox", { name: "Plain quote" })
        .querySelector("svg"),
    ).toHaveAttribute("data-icon", "blockquote");
    fireEvent.click(warning);

    expect(view.state.sliceDoc()).toBe("> [!warning] tea");
    expect(view.hasFocus).toBe(true);
  });

  it("focuses Plain quote in Quote's menu outside a quote, and follows the cursor", () => {
    const view = open("tea\n\n> [!tip] cup\n\n> [!bug] pot", false, true);
    act(() => {
      view.focus();
    });
    fireEvent.click(
      within(toolbar()).getByRole("button", { name: "Quote format" }),
    );
    const menu = screen.getByRole("menu", { name: "Quote format" });

    expect(
      within(menu).queryByRole("menuitemcheckbox", { checked: true }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Plain quote" }),
    ).toHaveFocus();

    act(() => {
      view.dispatch({ selection: { anchor: 15 } });
    });
    expect(
      within(menu).getByRole("menuitemcheckbox", { checked: true }),
    ).toHaveTextContent("Tip");
    // From one callout to another, as quoted as it.
    act(() => {
      view.dispatch({ selection: { anchor: 29 } });
    });
    expect(
      within(menu).getByRole("menuitemcheckbox", { checked: true }),
    ).toHaveTextContent("Bug");
  });

  it("turns a callout into a plain quote, or text, from Quote's menu", () => {
    const view = open("> [!tip]- tea", false, true);
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 13 } });
    });
    const pick = (name: string) => {
      fireEvent.click(
        within(toolbar()).getByRole("button", { name: "Quote format" }),
      );
      const menu = screen.getByRole("menu", { name: "Quote format" });
      fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name }));
    };
    // Closed once a format is picked, the menu has no name to find it by.
    const checked = () =>
      Array.from(
        document.querySelectorAll(
          '[aria-label="Quote format"] > [aria-checked="true"]',
        ),
        (item) => item.textContent,
      );
    pick("Plain quote");
    expect(view.state.sliceDoc()).toBe("> tea");
    expect(checked()).toEqual(["Plain quote"]);
    // The format checked takes the quote away.
    pick("Plain quote");
    expect(view.state.sliceDoc()).toBe("tea");
    expect(checked()).toEqual([]);
    pick("Plain quote");
    expect(view.state.sliceDoc()).toBe("> tea");
    pick("Tip");
    expect(view.state.sliceDoc()).toBe("> [!tip] tea");
    expect(checked()).toEqual(["Tip"]);
    pick("Tip");
    expect(view.state.sliceDoc()).toBe("tea");
    expect(view.hasFocus).toBe(true);
  });

  it("turns Quote's menu off in code, where it opens nothing", () => {
    const view = open("```\ncode\n```", false, true);
    act(() => {
      view.dispatch({ selection: { anchor: 5 } });
    });
    const type = within(toolbar()).getByRole("button", {
      name: "Quote format",
    });

    expect(type).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(type);
    expect(screen.queryByRole("menu", { name: "Quote format" })).toBeNull();
    expect(view.state.sliceDoc()).toBe("```\ncode\n```");
  });

  it("leaves Quote without a menu outside a vault", () => {
    open("> [!note] tea");

    expect(names()).not.toContain("Quote format");
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

  it("writes an empty table from Insert table, editing its first cell in Visual", async () => {
    const view = open("tea", true);
    act(() => {
      view.focus();
    });
    const insert = within(toolbar()).getByRole("button", {
      name: "Insert table",
    });
    expect(insert).toHaveAttribute("title", "Insert table");

    expect(fireEvent.mouseDown(insert)).toBe(false);
    fireEvent.click(insert);

    expect(view.state.sliceDoc()).toBe(
      "tea\n\n|  |  |\n| --- | --- |\n|  |  |",
    );
    const element = view.contentDOM.querySelector<HTMLElement>(
      ".cm-table .cm-editor",
    );
    expect(element && EditorView.findFromDOM(element)?.hasFocus).toBe(true);
    await waitFor(() => {
      expect(names()).toContain("Add row below");
    });
  });

  it("keeps Insert table off in a code block", () => {
    const view = open("```\ncode\n```");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 5 } });
    });
    const insert = within(toolbar()).getByRole("button", {
      name: "Insert table",
    });

    expect(insert).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(insert);
    expect(view.state.sliceDoc()).toBe("```\ncode\n```");
  });

  it("trades the buttons of lines for the table's in a cell, whose text it formats", async () => {
    // In a vault's note, whose Quote has a menu.
    const view = open("| Tea | Cups |\n| - | - |", true, true);
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
