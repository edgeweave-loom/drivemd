import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  ensureSyntaxTree,
  LanguageDescription,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchPanelOpen } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { runScopeHandlers, EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, type EditorHandle } from "./Editor.tsx";
import { linkAt } from "./source-links.ts";
import type { LineBreak } from "./text.ts";

function open(text: string, lineBreak: LineBreak = "\n") {
  const onChange = vi.fn<(text: string) => void>();
  const handle = createRef<EditorHandle>();
  const { container } = render(
    <Editor
      ref={handle}
      initial={text}
      lineBreak={lineBreak}
      onChange={onChange}
      onFollow={() => undefined}
    />,
  );
  const element = container
    .querySelector(".editor")
    ?.shadowRoot?.querySelector<HTMLElement>(".cm-editor");
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error("No editor");
  return { view, onChange, handle };
}

/**
 * Each line as the editor shows it: dimmed text in ‹›, and "(larger)" after
 * a line with text larger than the editor's.
 */
function looks(view: EditorView) {
  const size = getComputedStyle(view.contentDOM).fontSize;
  return [...view.contentDOM.querySelectorAll(".cm-line")].map((line) => {
    let shown = "";
    let larger = false;
    const texts = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      const style = getComputedStyle(text.parentElement ?? line);
      const value = text.textContent ?? "";
      larger ||= style.fontSize !== size;
      shown +=
        style.color === "var(--on-surface-variant)" ? `‹${value}›` : value;
    }
    return shown.replaceAll("›‹", "") + (larger ? " (larger)" : "");
  });
}

/** Waits for the editor's parse, which may end in the background. */
async function parsed(view: EditorView) {
  await waitFor(() => {
    expect(syntaxTreeAvailable(view.state)).toBe(true);
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
      "‹#› The plan (larger)",
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
