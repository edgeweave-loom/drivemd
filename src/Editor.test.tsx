import { cursorCharRight, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  ensureSyntaxTree,
  LanguageDescription,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchPanelOpen } from "@codemirror/search";
import { EditorState, StateEffect } from "@codemirror/state";
import { runScopeHandlers, EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, type EditorHandle } from "./Editor.tsx";
import { linkAt } from "./source-links.ts";
import type { LineBreak } from "./text.ts";

function open(text: string, lineBreak: LineBreak = "\n", visual = false) {
  const onChange = vi.fn<(text: string) => void>();
  const handle = createRef<EditorHandle>();
  const editor = (inVisual: boolean) => (
    <Editor
      ref={handle}
      initial={text}
      lineBreak={lineBreak}
      visual={inVisual}
      onChange={onChange}
      onFollow={() => undefined}
    />
  );
  const { container, rerender } = render(editor(visual));
  const element = container
    .querySelector(".editor")
    ?.shadowRoot?.querySelector<HTMLElement>(".cm-editor");
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error("No editor");
  return {
    view,
    onChange,
    handle,
    /** Shows the editor in Visual, or in Source. */
    showIn: (inVisual: boolean) => {
      rerender(editor(inVisual));
    },
  };
}

/**
 * Each line as the editor shows it: dimmed text in ‹›, text larger than the
 * editor's in ⟨⟩, and bold text in **.
 */
function looks(view: EditorView) {
  const size = getComputedStyle(view.contentDOM).fontSize;
  return [...view.contentDOM.querySelectorAll(".cm-line")].map((line) => {
    let shown = "";
    const texts = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      const style = getComputedStyle(text.parentElement ?? line);
      let value = text.textContent ?? "";
      if (style.fontWeight === "700") value = `**${value}**`;
      if (style.fontSize !== size) value = `⟨${value}⟩`;
      if (style.color === "var(--on-surface-variant)") value = `‹${value}›`;
      shown += value;
    }
    return shown
      .replaceAll("›‹", "")
      .replaceAll("⟩⟨", "")
      .replaceAll("****", "");
  });
}

/** Waits for the editor's parse, which may end in the background. */
async function parsed(view: EditorView) {
  await waitFor(() => {
    expect(syntaxTreeAvailable(view.state)).toBe(true);
  });
}

/** Once CodeMirror has measured the view, and scrolled as asked meanwhile. */
function measured(view: EditorView) {
  return new Promise<void>((resolve) => {
    view.requestMeasure({
      read: () => {
        resolve();
      },
    });
  });
}

function press(
  view: EditorView,
  key: string,
  modifiers: KeyboardEventInit = {},
) {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key, ...modifiers }),
    "editor",
  );
}

function paste(view: EditorView, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text, types: ["text/plain"] },
  });
  view.contentDOM.dispatchEvent(event);
}

describe("Editor", () => {
  it("edits the source, reporting it with the file's own line breaks", () => {
    const { view, onChange } = open("# Tea\r\n\r\nGreen", "\r\n");

    view.dispatch({ changes: { from: view.state.doc.length, insert: " tea" } });

    expect(onChange).toHaveBeenLastCalledWith("# Tea\r\n\r\nGreen tea");
    expect(view.state.doc.lines).toBe(3);
  });

  it("gives pasted lines the file's line break", () => {
    const { view, onChange } = open("Tea\r\n", "\r\n");
    view.dispatch({ selection: { anchor: 3 } });

    paste(view, "\ngreen\nblack");

    expect(onChange).toHaveBeenLastCalledWith("Tea\r\ngreen\r\nblack\r\n");
  });

  it.each([
    ["CRLF", "\r\n" as const, "a\nb\rc\r\nd"],
    ["LF", "\n" as const, "a\r\nb\rc"],
    ["CR", "\r" as const, "a\nb\r\nc"],
  ])(
    "gives any line break inserted, as a replacement does, the file's own: %s",
    (_, lineBreak, inserted) => {
      const { view, onChange } = open(`x${lineBreak}y`, lineBreak);

      view.dispatch({ changes: { from: 1, insert: inserted } });

      const text = onChange.mock.lastCall?.[0] ?? "";
      expect(text.replaceAll(lineBreak, "|")).toBe(
        `x${inserted.replace(/\r\n|\r|\n/g, "|")}|y`,
      );
      expect(view.state.sliceDoc()).toBe(text);
    },
  );

  it("keeps out what UTF-8 could not write back as shown: NUL, and half a character", () => {
    const { view, onChange } = open("x");

    view.dispatch({
      changes: { from: 1, insert: "a\u0000b\uD800c\uDC00d\uD83D\uDE00" },
    });

    expect(onChange).toHaveBeenLastCalledWith("xab\uFFFDc\uFFFDd\uD83D\uDE00");
  });

  it("continues a list, and a task list, on Enter", () => {
    const { view, onChange } = open("- [ ] Boil");
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    expect(press(view, "Enter")).toBe(true);

    expect(onChange).toHaveBeenLastCalledWith("- [ ] Boil\n- [ ] ");
  });

  it("undoes an edit", () => {
    const { view, onChange } = open("Tea");
    view.dispatch({ changes: { from: 3, insert: "s" } });

    press(view, "z", { ctrlKey: true });

    expect(onChange).toHaveBeenLastCalledWith("Tea");
  });

  it("indents and outdents a list item by its level from the keyboard, as the toolbar does", () => {
    // Below front matter, which the editor parses apart from the Markdown.
    const { view, onChange } = open("---\nowner: Ada\n---\n1. Tea\n2. Milk");
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    press(view, "]", { ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      "---\nowner: Ada\n---\n1. Tea\n   1. Milk",
    );
    press(view, "[", { ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(
      "---\nowner: Ada\n---\n1. Tea\n1. Milk",
    );
  });

  it("takes a task tapped in the preview as one edit, if it still holds the text shown", () => {
    const { view, onChange, handle } = open(
      "- [ ] Boil\r\n- [ ] Pour\r\n",
      "\r\n",
    );
    view.dispatch({ selection: { anchor: 20 } });

    handle.current?.offer(
      "- [ ] Boil\r\n- [ ] Pour\r\n",
      "- [ ] Boil\r\n- [x] Pour\r\n",
    );
    handle.current?.offer("- [ ] Boil", "- [x] Boil");

    expect(view.state.sliceDoc()).toBe("- [ ] Boil\r\n- [x] Pour\r\n");
    expect(view.state.selection.main.head).toBe(20);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "- [ ] Boil\r\n- [x] Pour\r\n",
    );
    press(view, "z", { ctrlKey: true });
    expect(view.state.sliceDoc()).toBe("- [ ] Boil\r\n- [ ] Pour\r\n");
  });

  it("marks code blocks, to show them in monospace", () => {
    const { view } = open("Tea\n\n```js\nconst a = 1;\n```\n\nMore");

    const marked = [...view.dom.querySelectorAll(".cm-code-line")].map(
      (line) => line.textContent,
    );
    expect(marked).toEqual(["```js", "const a = 1;", "```"]);
  });

  it("shows front matter as YAML at the text's size, its keys and symbols dimmed as Markdown's are", async () => {
    const { view } = open(
      "---\nowner: Ada\ntags: [tea, cups]\n---\n\n# The plan\n",
    );
    await parsed(view);

    expect(looks(view)).toEqual([
      "‹---›",
      "‹owner:› Ada",
      "‹tags:› ‹[›tea‹,› cups‹]›",
      "‹---›",
      "",
      "‹#›⟨** The plan**⟩",
      "",
    ]);
  });

  it("dims headings' and bold text's marks at the text's size and weight", async () => {
    const { view } = open("# Plan\n\n## Tasks\n\nTea\n===\n\nSome __tea__\n");
    await parsed(view);

    expect(looks(view)).toEqual([
      "‹#›⟨** Plan**⟩",
      "",
      "‹##›⟨** Tasks**⟩",
      "",
      "⟨**Tea**⟩",
      "‹===›",
      "",
      "Some ‹__›**tea**‹__›",
      "",
    ]);
  });

  it("dims only YAML's keys and symbols, not those of code in other languages", async () => {
    await LanguageDescription.matchLanguageName(languages, "js")?.load();
    const { view } = open("```js\n// Tea\nconst cups = { tea: 2 };\n```");
    await parsed(view);

    expect(looks(view)).toEqual([
      "‹```›js",
      "// Tea",
      "const cups = { tea: 2 };",
      "‹```›",
    ]);
  });
});

describe("Visual", () => {
  beforeEach(() => {
    // jsdom names Apple as its vendor, so CodeMirror reads the selection in
    // a shadow root as Safari needs, through a command jsdom lacks.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
  });

  const NOTE = [
    "# The plan ##",
    "",
    "Some **tea**, _cups_, ~~coffee~~ and `water`.",
    "",
    "Tea",
    "===",
    "#",
  ].join("\n");

  it("hides Markdown's symbols, where no line is being written", async () => {
    const { view } = open(NOTE, "\n", true);
    await parsed(view);

    expect(looks(view)).toEqual([
      "⟨**The plan**⟩",
      "",
      "Some **tea**, cups, coffee and water.",
      "",
      "⟨**Tea**⟩",
      "‹===›",
      "‹#›",
    ]);
    expect(view.contentDOM).toHaveAccessibleName("Note");
  });

  it("shows the symbols of the lines the selection touches while it has the focus", async () => {
    const { view } = open(NOTE, "\n", true);
    await parsed(view);

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 3, head: 20 } });
    });

    await waitFor(() => {
      expect(looks(view).slice(0, 3)).toEqual([
        "‹#›⟨** The plan **⟩‹##›",
        "",
        "Some ‹**›**tea**‹**›, ‹_›cups‹_›, ‹~~›coffee‹~~› and ‹`›water‹`›.",
      ]);
    });
    act(() => {
      view.contentDOM.blur();
    });
    await waitFor(() => {
      expect(looks(view)[0]).toBe("⟨**The plan**⟩");
    });
  });

  it("shows a line's symbols only once the finger that pressed on it lifts", async () => {
    const { view } = open(
      "See [the docs](docs.md) and [a page](page.md).\n\nTea",
      "\n",
      true,
    );
    await parsed(view);

    // A finger lifting at once, as from a tap.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // The cursor moving under a finger, the line stays as it was.
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.focus();
        view.dispatch({ selection: { anchor: 30 } });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(looks(view)[0]).toBe("See the docs and a page.");

      // A second finger lifting leaves the first one down.
      fireEvent.touchEnd(view.contentDOM, { touches: [{}] });
      expect(looks(view)[0]).toBe("See the docs and a page.");
      // Lifting where the editor may not see it: from a line drawn anew.
      fireEvent.touchEnd(document.body, { touches: [] });
      expect(looks(view)[0]).toBe(
        "See ‹[›the docs‹](docs.md)› and ‹[›a page‹](page.md)›.",
      );
      expect(view.state.selection.main).toMatchObject({ anchor: 30, head: 30 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the cursor a long press moved to iOS for a moment once the finger lifts", async () => {
    const { view } = open(
      "See [the docs](docs.md) and [a page](page.md).\n\nSome tea and cups.",
      "\n",
      true,
    );
    await parsed(view);
    // jsdom lays no text out, which CodeMirror measures meanwhile: a
    // range's boxes are an element's, none.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // With the focus, a long press moves the cursor, under iOS's loupe.
      act(() => {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        view.focus();
      });
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.dispatch({ selection: { anchor: 32 } });
      });
      vi.setSystemTime(Date.now() + 600);

      // iOS places the cursor again once the finger lifts, from where it
      // was on the line as drawn.
      fireEvent.touchEnd(document.body, { touches: [] });
      act(() => {
        view.dispatch({ selection: { anchor: 32 }, userEvent: "select" });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(looks(view)[0]).toBe("See the docs and a page.");

      await waitFor(() => {
        expect(looks(view)[0]).toBe(
          "See ‹[›the docs‹](docs.md)› and ‹[›a page‹](page.md)›.",
        );
      });
      expect(view.state.selection.main).toMatchObject({ anchor: 32, head: 32 });
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("leaves the word a long press selected to iOS for a moment once the finger lifts", async () => {
    const { view } = open(
      "See [the docs](docs.md) and [a page](page.md).",
      "\n",
      true,
    );
    await parsed(view);
    // jsdom lays no text out, which CodeMirror measures meanwhile: a
    // range's boxes are an element's, none.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
    try {
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.focus();
        view.dispatch({ selection: { anchor: 31, head: 35 } });
      });

      // iOS sets the word's selection again once the finger lifts, from where
      // it was on the line as drawn.
      fireEvent.touchEnd(document.body, { touches: [] });
      act(() => {
        view.dispatch({
          selection: { anchor: 31, head: 35 },
          userEvent: "select",
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(looks(view)[0]).toBe("See the docs and a page.");

      await waitFor(() => {
        expect(looks(view)[0]).toBe(
          "See ‹[›the docs‹](docs.md)› and ‹[›a page‹](page.md)›.",
        );
      });
      expect(view.state.selection.main).toMatchObject({ anchor: 31, head: 35 });
    } finally {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("keeps the lines as they are for a finger that presses again meanwhile", async () => {
    const { view } = open("See [a page](page.md).", "\n", true);
    await parsed(view);
    // jsdom lays no text out, which CodeMirror measures meanwhile: a
    // range's boxes are an element's, none.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
    try {
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.focus();
        view.dispatch({ selection: { anchor: 7, head: 11 } });
      });
      fireEvent.touchEnd(document.body, { touches: [] });

      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(looks(view)[0]).toBe("See a page.");
    } finally {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("puts off scrolling to the cursor while a finger is down, until it lifts", async () => {
    const { view } = open("Some **tea**.\n\n## Cups ##", "\n", true);
    await parsed(view);
    const scrolls: number[] = [];
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.scrollHandler.of((_, range) => {
          scrolls.push(range.head);
          return true;
        }),
      ),
    });
    // Which jsdom lacks, and CodeMirror measures text with.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
    // CodeMirror scrolls only an editor with a height, which jsdom lays out
    // none of.
    Object.defineProperty(view.scrollDOM, "clientHeight", { value: 400 });
    // Typed in before the press.
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: 13, insert: "!" } });
    });
    act(() => {
      view.dispatch({ selection: { anchor: 6 } });
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // As the keyboard comes up under a long press and settles, which would
      // move the text under the finger, and the selection iOS makes with it.
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.dispatch({ effects: EditorView.scrollIntoView(6) });
      });
      await measured(view);
      expect(scrolls).toEqual([]);

      // Nor while iOS sets the selection again, once the finger lifts.
      vi.setSystemTime(Date.now() + 600);
      fireEvent.touchEnd(document.body, { touches: [] });
      await measured(view);
      expect(scrolls).toEqual([]);
      await waitFor(() => {
        expect(scrolls).toEqual([6]);
      });

      // Once only.
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      fireEvent.touchEnd(document.body, { touches: [] });
      await measured(view);
      expect(scrolls).toEqual([6]);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("scrolls into view after a key or an edit while a finger is down", async () => {
    const { view } = open("Some tea.", "\n", true);
    await parsed(view);
    const scrolls: number[] = [];
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.scrollHandler.of((_, range) => {
          scrolls.push(range.head);
          return true;
        }),
      ),
    });
    // Which jsdom lacks, and CodeMirror measures text with.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
    // CodeMirror scrolls only an editor with a height, which jsdom lays out
    // none of.
    Object.defineProperty(view.scrollDOM, "clientHeight", { value: 400 });

    try {
      // Typing goes on where iOS lost the lift of a finger: on a hardware
      // keyboard,
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.focus();
      });
      fireEvent.keyDown(view.contentDOM, { key: "ArrowRight" });
      await measured(view);
      expect(scrolls).toEqual([1]);

      // or as dictation does, without a key.
      fireEvent.touchStart(view.contentDOM, { touches: [{}] });
      act(() => {
        view.dispatch({
          changes: { from: 8, insert: " and cups" },
          selection: { anchor: 17 },
          scrollIntoView: true,
        });
      });
      await measured(view);
      expect(scrolls).toEqual([1, 17]);
    } finally {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("keeps the line a finger pressed where it was as the lines above it change", async () => {
    const { view } = open("Some **tea**.\n\n## Cups ##", "\n", true);
    await parsed(view);
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 6 } });
    });
    // The heading starts 78 px down the page, until the paragraph above it
    // hides its symbols and takes a line less.
    let paragraph = 52;
    vi.spyOn(view, "lineBlockAt").mockImplementation(
      (at) =>
        ({ top: at < 14 ? 0 : paragraph + 26 }) as ReturnType<
          EditorView["lineBlockAt"]
        >,
    );
    vi.spyOn(view, "posAtCoords").mockReturnValue(17);
    const scrollBy = vi.spyOn(window, "scrollBy").mockReturnValue();
    let scrolled = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrolled);
    vi.spyOn(view, "documentTop", "get").mockImplementation(() => -scrolled);
    // Which jsdom lacks, and CodeMirror measures text with.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => [],
      configurable: true,
    });

    try {
      fireEvent.touchStart(view.contentDOM, {
        touches: [{ clientX: 40, clientY: 100 }],
        changedTouches: [{ clientX: 40, clientY: 100 }],
      });
      // As iOS scrolls on its own meanwhile, which stays.
      scrolled = 30;
      fireEvent.touchEnd(document.body, { touches: [] });
      paragraph = 26;
      act(() => {
        view.dispatch({
          selection: { anchor: 17 },
          userEvent: "select.pointer",
        });
      });

      await waitFor(() => {
        expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0, -26);
      });
    } finally {
      vi.restoreAllMocks();
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });

  it("leaves a mouse's selections to scroll as CodeMirror scrolls them", async () => {
    const { view } = open("Some **tea**.\n\n## Cups ##", "\n", true);
    await parsed(view);
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

    // Long after any finger, as a drag past the window's edge selects
    // again, every 50 ms.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60_000);
      view.dispatch({ selection: { anchor: 17 }, userEvent: "select.pointer" });
    } finally {
      vi.useRealTimers();
    }

    expect(scrolls).toEqual([0]);
  });

  it("hides an inline link's brackets and address, leaving its text", async () => {
    const { view } = open(
      [
        'See [the *docs*](https://example.com "Docs") and <https://example.com>.',
        "A [reference][docs], [](empty.md) and [docs].",
        "",
        "[docs]: https://example.com",
      ].join("\n"),
      "\n",
      true,
    );
    await parsed(view);

    expect(looks(view)).toEqual([
      "See the docs and ‹<https://example.com>›.",
      "A ‹[›reference‹]›[docs], ‹[](empty.md)› and ‹[›docs‹]›.",
      "",
      "[docs]‹:› ‹https://example.com›",
    ]);
  });

  it("draws a bullet list's markers as bullets, and a task's as its box", async () => {
    const { view } = open(
      "- Tea\n- [ ] Boil\n* [x] Cups\n1. One\n2. [X] Two",
      "\n",
      true,
    );
    await parsed(view);

    expect(looks(view)).toEqual([
      "• Tea",
      " Boil",
      " Cups",
      "‹1.› One",
      " Two",
    ]);
    expect(
      [...view.contentDOM.querySelectorAll<HTMLInputElement>(".cm-task")].map(
        (box) => box.checked,
      ),
    ).toEqual([false, true, true]);
    // Drawn as they were, as the text changes around them.
    const bullet = view.contentDOM.querySelector(".cm-bullet");
    view.dispatch({ changes: { from: 5, insert: "s" } });
    expect(view.contentDOM.querySelector(".cm-bullet")).toBe(bullet);
  });

  it("draws a thematic break as a rule, but not a setext heading's underline nor the front matter's fences", async () => {
    const { view } = open(
      "---\nowner: Ada\n---\nTea\n---\n\n***\n\n- - -\n\n___",
      "\n",
      true,
    );
    await parsed(view);
    const rules = () =>
      [...view.contentDOM.querySelectorAll(".cm-line")].map(
        (line) => line.querySelector(".cm-rule") !== null,
      );

    expect(rules()).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(
      within(view.contentDOM)
        .getAllByRole("separator")
        .map((rule) => rule.textContent),
    ).toEqual(["***", "- - -", "___"]);

    // Written as it is while the cursor is on it.
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 34 } });
    });
    await waitFor(() => {
      expect(rules()[8]).toBe(false);
    });
    expect(rules()[6]).toBe(true);
  });

  it("ticks a task from its box, as one edit that undo reverts, the cursor staying", async () => {
    const { view, onChange } = open("Tea\n- [ ] Boil", "\n", true);
    await parsed(view);
    view.dispatch({ selection: { anchor: 1 } });
    const box = () =>
      view.contentDOM.querySelector<HTMLInputElement>(".cm-task");

    fireEvent.mouseDown(box() ?? view.contentDOM);
    // The box shows what the text says, not what its click would.
    expect(fireEvent.click(box() ?? view.contentDOM)).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith("Tea\n- [x] Boil");
    expect(box()?.checked).toBe(true);
    expect(view.state.selection.main.head).toBe(1);
    fireEvent.mouseDown(box() ?? view.contentDOM);
    expect(view.state.sliceDoc()).toBe("Tea\n- [ ] Boil");

    undo(view);
    expect(view.state.sliceDoc()).toBe("Tea\n- [x] Boil");
    undo(view);
    expect(view.state.sliceDoc()).toBe("Tea\n- [ ] Boil");
  });

  it("ticks a task from a finger's tap on its box, its start kept from the browser", async () => {
    const { view } = open("Tea\n- [ ] Boil", "\n", true);
    await parsed(view);
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    const box = () =>
      view.contentDOM.querySelector<HTMLInputElement>(".cm-task") ??
      view.contentDOM;
    const touch = (clientY: number) => [{ clientX: 10, clientY }];

    // Its start kept from the browser, but not its end, or Chrome on Android
    // brings up the keyboard that Back hid (#281).
    expect(
      fireEvent.touchStart(box(), {
        touches: touch(20),
        changedTouches: touch(20),
      }),
    ).toBe(false);
    expect(
      fireEvent.touchEnd(box(), { touches: [], changedTouches: touch(22) }),
    ).toBe(true);
    expect(view.state.sliceDoc()).toBe("Tea\n- [x] Boil");

    // A finger moving from the box leaves the task as it is.
    fireEvent.touchStart(box(), {
      touches: touch(20),
      changedTouches: touch(20),
    });
    fireEvent.touchEnd(box(), { touches: [], changedTouches: touch(80) });
    expect(view.state.sliceDoc()).toBe("Tea\n- [x] Boil");

    undo(view);
    expect(view.state.sliceDoc()).toBe("Tea\n- [ ] Boil");
  });

  it("leaves a task as it is under a long press on its box", async () => {
    const { view } = open("Tea\n- [ ] Boil", "\n", true);
    await parsed(view);
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    const box =
      view.contentDOM.querySelector<HTMLInputElement>(".cm-task") ??
      view.contentDOM;
    const touch = [{ clientX: 10, clientY: 20 }];

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      fireEvent.touchStart(box, { touches: touch, changedTouches: touch });
      vi.advanceTimersByTime(600);
      fireEvent.touchEnd(box, { touches: [], changedTouches: touch });
    } finally {
      vi.useRealTimers();
    }
    expect(view.state.sliceDoc()).toBe("Tea\n- [ ] Boil");
  });

  it("skips a hidden symbol as one unit", async () => {
    const { view } = open("**Tea**", "\n", true);
    await parsed(view);

    view.dispatch({ selection: { anchor: 0 } });
    cursorCharRight(view);

    expect(view.state.selection.main.head).toBe(2);
  });

  it("switches to Source and back, keeping the text and its history", async () => {
    const { view, showIn } = open("**Tea**", "\n", true);
    await parsed(view);
    view.dispatch({ changes: { from: 7, insert: " cups" } });

    showIn(false);
    expect(looks(view)).toEqual(["‹**›**Tea**‹**› cups"]);
    expect(view.contentDOM).toHaveAccessibleName("Markdown source");
    showIn(true);
    expect(looks(view)).toEqual(["**Tea** cups"]);
    undo(view);
    expect(view.state.sliceDoc()).toBe("**Tea**");
  });
});

describe("linkAt", () => {
  function state(text: string) {
    const made = EditorState.create({
      doc: text,
      extensions: markdown({ base: markdownLanguage }),
    });
    ensureSyntaxTree(made, made.doc.length, 5_000);
    return made;
  }

  it.each([
    [
      "an inline link, on its text",
      "See [the plan](plan.md) now",
      "the",
      "plan.md",
    ],
    [
      "an inline link, on its address",
      "See [the plan](plan.md) now",
      "an.md",
      "plan.md",
    ],
    [
      "a link with a title",
      '[Plan](../plan.md "The plan")',
      "Plan",
      "../plan.md",
    ],
    ["a link in angle brackets", "[Mine](<My note.md>)", "Mine", "My note.md"],
    [
      "an autolink",
      "<https://example.com/docs>",
      "example",
      "https://example.com/docs",
    ],
    [
      "a bare web address",
      "Go to https://example.com today",
      "example",
      "https://example.com",
    ],
    ["an image", "![A chart](img/chart.png)", "chart", "img/chart.png"],
    [
      "an image in a link, as the link",
      "[![badge](b.png)](target.md)",
      "badge",
      "target.md",
    ],
    [
      "a bare www address, on the web",
      "Go to www.example.com today",
      "example",
      "http://www.example.com",
    ],
    [
      "a bare email address",
      "Write to ada@example.com today",
      "example",
      "mailto:ada@example.com",
    ],
    [
      "an email autolink",
      "<ada@example.com>",
      "example",
      "mailto:ada@example.com",
    ],
    [
      "a link with escapes and entities",
      "[x](my\\_note&amp;tea.md)",
      "my",
      "my_note&tea.md",
    ],
    [
      "a link with numeric character references",
      "[x](a&#38;b&#x26;c&nope;d&#0;e.md)",
      "x",
      "a&b&c&nope;d&#0;e.md",
    ],
  ])("finds the address of %s", (_, text, near, href) => {
    const made = state(text);
    expect(linkAt(made, text.indexOf(near) + 1)).toBe(href);
  });

  it.each([
    ["plain text", "See the plan now", "plan"],
    ["a reference link", "[Plan][1]\n\n[1]: plan.md", "Plan"],
  ])("finds nothing in %s", (_, text, near) => {
    expect(linkAt(state(text), text.indexOf(near) + 1)).toBeUndefined();
  });
});

describe("Find in note", () => {
  beforeEach(() => {
    // jsdom names Apple as its vendor, so CodeMirror reads the selection in
    // a shadow root as Safari needs, through a command jsdom lacks.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    // Nor does it lay text out, which CodeMirror measures as it scrolls to
    // the match: a range's boxes are an element's, none.
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => document.createElement("span").getClientRects(),
      configurable: true,
    });
  });

  /** Opens Find in note from the keyboard, as Cmd or Ctrl+F does. */
  function find(view: EditorView) {
    act(() => {
      press(view, "f", { ctrlKey: true });
    });
    return screen.getByRole("textbox", { name: "Find" });
  }

  function type(field: HTMLElement, text: string) {
    fireEvent.change(field, { target: { value: text } });
  }

  function count() {
    return screen
      .getByRole("search", { name: "Find in note" })
      .querySelector(".find-count")?.textContent;
  }

  function pick(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Find options" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
  }

  it("finds text in the whole file from its own bar, its field focused", () => {
    const { view } = open("Tea, then tea.");

    const field = find(view);
    expect(field).toHaveFocus();
    type(field, "tea");
    expect(count()).toBe("2 matches");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(count()).toBe("1 of 2");
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(count()).toBe("2 of 2");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(count()).toBe("1 of 2");
  });

  it("starts from the selected text, and says when nothing matches", () => {
    const { view } = open("Tea for two");
    view.dispatch({ selection: { anchor: 4, head: 7 } });

    const field = find(view);
    expect(field).toHaveValue("for");
    expect(count()).toBe("1 of 1");

    type(field, "coffee");
    expect(count()).toBe("No matches");
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  it("counts the matches up to a thousand", () => {
    const { view } = open("a".repeat(1200));

    type(find(view), "a");

    expect(count()).toBe("1000+ matches");
  });

  it("matches case, whole words or a regular expression, as picked", () => {
    const { view } = open("Tea, tea, teapot.");
    const field = find(view);
    type(field, "tea");
    expect(count()).toBe("3 matches");

    pick("Match case");
    expect(count()).toBe("2 matches");
    expect(field).toHaveFocus();
    pick("Whole word");
    expect(count()).toBe("1 match");
    expect(
      screen.getByRole("menuitemcheckbox", {
        name: "Whole word",
        hidden: true,
      }),
    ).toHaveAttribute("aria-checked", "true");

    pick("Whole word");
    pick("Regular expression");
    type(field, "t[e");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(count()).toBeUndefined();
    type(field, "t.a");
    expect(count()).toBe("2 matches");
  });

  it("replaces the match, or all of them", () => {
    const { view, onChange } = open("tea, tea");
    type(find(view), "tea");

    pick("Replace");
    const replacement = screen.getByRole("textbox", { name: "Replace with" });
    expect(replacement).toHaveFocus();
    type(replacement, "chai");
    fireEvent.keyDown(replacement, { key: "Enter" });
    fireEvent.keyDown(replacement, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("chai, tea");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(onChange).toHaveBeenLastCalledWith("chai, chai");
  });

  it("gives the focus back to the text as it closes, from Escape or its button", async () => {
    const { view } = open("Tea");

    fireEvent.keyDown(find(view), { key: "Escape" });
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.hasFocus).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole("search")).toBeNull();
    });

    find(view);
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.hasFocus).toBe(true);
  });

  it("leaves the focus, and the keyboard, in its field as its buttons are pressed", () => {
    const { view } = open("Tea, tea");
    type(find(view), "tea");

    // A false answer means the browser's default, the focus moving to the
    // button, was prevented.
    for (const name of ["Previous match", "Next match", "Find options"]) {
      expect(fireEvent.mouseDown(screen.getByRole("button", { name }))).toBe(
        false,
      );
    }
    expect(
      fireEvent.mouseDown(
        screen.getByRole("menuitemcheckbox", {
          name: "Match case",
          hidden: true,
        }),
      ),
    ).toBe(false);
  });

  it("gives its field the focus again when asked while it is open", () => {
    const { view } = open("Tea");
    find(view);
    act(() => {
      view.focus();
    });

    expect(find(view)).toHaveFocus();
  });

  it("keeps the matches clear of the bars over the page's top", () => {
    const appBar = document.body.appendChild(document.createElement("header"));
    appBar.className = "bar";
    vi.spyOn(appBar, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 0, 56),
    );
    const { view } = open("Tea");
    find(view);
    vi.spyOn(
      screen.getByRole("search", { name: "Find in note" }),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 56, 0, 56));

    expect(
      view.state.facet(EditorView.scrollMargins).map((of) => of(view)),
    ).toContainEqual({ top: 112, bottom: 0 });
    appBar.remove();
  });
});
