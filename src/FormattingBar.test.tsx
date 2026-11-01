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
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    .map((button) => button.getAttribute("aria-label"));
}

describe("the formatting toolbar", () => {
  beforeEach(() => {
    // jsdom names Apple as its vendor, so CodeMirror reads the selection in
    // a shadow root as Safari needs, through a command jsdom lacks.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
  });

  it("shows over the note with a mouse, each button named in its tooltip", () => {
    open("tea");

    expect(names()).toEqual([
      "Find in note",
      "Undo",
      "Redo",
      "Heading",
      "Bold",
      "Italic",
      "Strikethrough",
      "Code",
      "Link",
      "Bulleted list",
      "Numbered list",
      "Checkbox",
      "Outdent",
      "Indent",
    ]);
    expect(
      within(toolbar()).getByRole("button", { name: "Bold" }),
    ).toHaveAttribute("title", "Bold");
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
    const list = within(toolbar()).getByRole("button", {
      name: "Bulleted list",
    });

    // The press keeps the focus where it is.
    expect(fireEvent.mouseDown(list)).toBe(false);
    fireEvent.click(list);

    expect(view.state.sliceDoc()).toBe("- tea");
    expect(view.hasFocus).toBe(true);
  });

  it("leaves out the buttons of lines in a table's cell, whose text it formats", async () => {
    const view = open("| Tea | Cups |\n| - | - |", true);
    await waitFor(() => {
      expect(syntaxTreeAvailable(view.state)).toBe(true);
    });
    const drawn = [...view.contentDOM.querySelectorAll("th")].find(
      (cell) => cell.textContent === "Tea",
    );
    fireEvent.mouseDown(drawn ?? document.body);
    const cell = EditorView.findFromDOM(
      view.contentDOM.querySelector<HTMLElement>(".cm-table .cm-editor") ??
        document.body,
    );
    if (!cell) throw new Error("No cell's editor");
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
      ]);
    });
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Bold" }));

    expect(view.state.sliceDoc()).toBe("| **Tea** | Cups |\n| - | - |");
    expect(cell.hasFocus).toBe(true);
  });
});
