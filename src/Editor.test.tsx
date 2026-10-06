import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  ensureSyntaxTree,
  LanguageDescription,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { runScopeHandlers, EditorView } from "@codemirror/view";
import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
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
      shown += style.color === "var(--muted)" ? `‹${value}›` : value;
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

  it("keeps two spaces typed after a word, which iOS turns into a period", async () => {
    // iOS inserts the second space, then replaces the first with a period,
    // whatever the editor asks of its corrections.
    const { view, onChange } = open("Tea  ");
    view.dispatch({ selection: { anchor: 5 } });
    const line = view.contentDOM.querySelector(".cm-line");
    if (!(line?.firstChild instanceof Text)) throw new Error("No text");

    line.firstChild.data = "Tea. ";

    await waitFor(() => {
      expect(view.contentDOM.textContent).toBe("Tea  ");
    });
    expect(view.state.sliceDoc()).toBe("Tea  ");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    // A period typed by hand, after a space or in place of a letter.
    ["Tea ", 4, 4, "Tea .", "Tea ."],
    ["Tea  ", 2, 2, "T.a  ", "T.a  "],
    // Another mark, or a period in place of more than a space.
    ["Tea  ", 5, 5, "Tea, ", "Tea, "],
    ["x  ", 3, 3, ". ", ". "],
    // A period away from the cursor, or over a selection.
    ["Tea  x", 6, 6, "Tea. x", "Tea. x"],
    ["Tea  ", 3, 5, "Tea. ", "Tea. "],
    // Two spaces at the start of a line, or after another, where no
    // sentence ends.
    ["  ", 2, 2, ". ", ". "],
    ["a   ", 4, 4, "a . ", "a . "],
  ])("keeps any other change: %j", async (text, anchor, head, typed, kept) => {
    const { view } = open(text);
    view.dispatch({ selection: { anchor, head } });
    const line = view.contentDOM.querySelector(".cm-line");
    if (!(line?.firstChild instanceof Text)) throw new Error("No text");

    line.firstChild.data = typed;

    await waitFor(() => {
      expect(view.state.sliceDoc()).toBe(kept);
    });
  });

  it("keeps a period put in place of a space while text is selected", () => {
    const { view } = open("Tea  ");
    view.dispatch({ selection: { anchor: 4, head: 5 } });
    const insert = vi.fn();

    // As an input method might, away from the selection.
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, 3, 4, ".", insert));

    expect(handled).toBe(false);
  });

  it("continues a list, and a task list, on Enter", () => {
    const { view, onChange } = open("- [ ] Boil");
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    expect(press(view, "Enter")).toBe(true);

    expect(onChange).toHaveBeenLastCalledWith("- [ ] Boil\n- [ ] ");
  });

  it("finds text in the whole file with its own search panel", () => {
    const { view } = open("Tea");

    press(view, "f", { ctrlKey: true });

    // At the top, where a phone's keyboard does not hide it.
    expect(view.dom.querySelector(".cm-panels-top .cm-search")).not.toBeNull();
  });

  it("undoes an edit", () => {
    const { view, onChange } = open("Tea");
    view.dispatch({ changes: { from: 3, insert: "s" } });

    press(view, "z", { ctrlKey: true });

    expect(onChange).toHaveBeenLastCalledWith("Tea");
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
