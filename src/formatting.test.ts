// @vitest-environment node
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import {
  cycleHeading,
  cycleTask,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleList,
} from "./formatting.ts";

/**
 * A state from text marked with its selection: `|` for a cursor, `«…»` for
 * a selected range.
 */
function open(marked: string, extensions: Extension[] = []) {
  const ranges: SelectionRange[] = [];
  let doc = "";
  let anchor = 0;
  for (const char of marked) {
    if (char === "|") ranges.push(EditorSelection.cursor(doc.length));
    else if (char === "«") anchor = doc.length;
    else if (char === "»")
      ranges.push(EditorSelection.range(anchor, doc.length));
    else doc += char;
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges),
    extensions: [
      markdown({ base: markdownLanguage }),
      EditorState.allowMultipleSelections.of(true),
      ...extensions,
    ],
  });
}

/** The state's text, marked with its selection as `open` reads it. */
function marked(state: EditorState) {
  let text = state.doc.toString();
  for (const { from, to, empty } of [...state.selection.ranges].reverse()) {
    text = empty
      ? `${text.slice(0, from)}|${text.slice(from)}`
      : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
  }
  return text;
}

function run(command: StateCommand, text: string | EditorState) {
  let state = typeof text === "string" ? open(text) : text;
  const transactions: Transaction[] = [];
  const done = command({
    state,
    dispatch(transaction) {
      transactions.push(transaction);
      state = transaction.state;
    },
  });
  expect(done).toBe(true);
  expect(transactions).toHaveLength(1);
  return { text: marked(state), state };
}

describe("cycleHeading", () => {
  it.each([
    ["|plan", "# |plan"],
    ["pl|an", "# pl|an"],
    ["# pl|an", "## pl|an"],
    ["## pl|an", "### pl|an"],
    ["### pl|an", "pl|an"],
    ["#### pl|an", "pl|an"],
    ["#\tpl|an", "##\tpl|an"],
    ["|", "# |"],
    ["#|", "##|"],
    ["> pl|an", "> # pl|an"],
    ["#tag|", "# #tag|"],
  ])("turns %j into %j", (before, after) => {
    expect(run(cycleHeading, before).text).toBe(after);
  });

  it("gives every selected line the level after the first line's", () => {
    expect(run(cycleHeading, "«## one\n\ntwo\n# three»").text).toBe(
      "«### one\n\n### two\n### three»",
    );
    expect(run(cycleHeading, "### o«ne\ntwo»").text).toBe("o«ne\ntwo»");
    expect(run(cycleHeading, "«# one\n#### two»").text).toBe(
      "«## one\n## two»",
    );
  });
});

describe("toggleBold", () => {
  it.each([
    ["a «word» b", "a **«word»** b"],
    ["a « word » b", "a  **«word»**  b"],
    ["a |b", "a **|**b"],
    ["a **|**b", "a |b"],
    ["a **wo|rd** b", "a wo|rd b"],
    ["a **|word** b", "a |word b"],
    ["a |**word** b", "a |word b"],
    ["a **word|** b", "a **word**| b"],
    ["a **«word»** b", "a «word» b"],
    ["a «**word**» b", "a «word» b"],
    ["**wo«rd** b»", "**wo**«rd** b»**"],
    ["a **so «me» word** b", "a so «me» word b"],
    ["a __wo|rd__ b", "a wo|rd b"],
    ["a **word**| b", "a **word****|** b"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleBold, before).text).toBe(after);
  });

  it("bolds each selected range", () => {
    expect(run(toggleBold, "«a» b «c»").text).toBe("**«a»** b **«c»**");
  });
});

describe("toggleList", () => {
  it.each([
    ["te|a", "- te|a"],
    ["|tea", "- |tea"],
    ["|", "- |"],
    ["  te|a", "  - te|a"],
    ["> te|a", "> - te|a"],
    ["- te|a", "te|a"],
    ["*\tte|a", "te|a"],
    ["  + te|a", "  te|a"],
    ["- [ ] te|a", "te|a"],
    ["> - [x] te|a", "> te|a"],
    ["1. te|a", "- te|a"],
    ["12) te|a", "- te|a"],
    ["**bold** te|a", "- **bold** te|a"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleList, before).text).toBe(after);
  });

  it("lists every selected line unless all of them are listed", () => {
    expect(run(toggleList, "«one\n\n- two»").text).toBe("- «one\n\n- two»");
    expect(run(toggleList, "«- one\n\n* two»").text).toBe("«one\n\ntwo»");
  });

  it("leaves out the line where the selection ends at its start", () => {
    expect(run(toggleList, "«one\n»two").text).toBe("- «one\n»two");
  });
});

describe("cycleTask", () => {
  it.each([
    ["te|a", "- [ ] te|a"],
    ["|", "- [ ] |"],
    ["- te|a", "- [ ] te|a"],
    ["- [ ] te|a", "- [x] te|a"],
    ["- [x] te|a", "- te|a"],
    ["- [X] te|a", "- te|a"],
    ["1. te|a", "1. [ ] te|a"],
    ["> - [ ] te|a", "> - [x] te|a"],
    ["  * [x] te|a", "  * te|a"],
  ])("turns %j into %j", (before, after) => {
    expect(run(cycleTask, before).text).toBe(after);
  });

  it("gives every selected line the state after the first line's", () => {
    expect(run(cycleTask, "«- [ ] one\n\ntwo\n- [x] three»").text).toBe(
      "«- [x] one\n\n- [x] two\n- [x] three»",
    );
    expect(run(cycleTask, "«- [x] one\n- [ ] two\nthree»").text).toBe(
      "«- one\n- two\n- three»",
    );
  });

  it("leaves a line alone that already is in that state", () => {
    expect(run(cycleTask, "«- [ ] one\n- [X] two»").text).toBe(
      "«- [x] one\n- [X] two»",
    );
  });
});

describe("insertLink", () => {
  it.each([
    ["a «word» b", "a [word](|) b"],
    ["a |b", "a [|]()b"],
    [
      "see «https://example.com/a?b=c» now",
      "see [|](https://example.com/a?b=c) now",
    ],
    ["«https://example.com/a b»", "[https://example.com/a b](|)"],
  ])("turns %j into %j", (before, after) => {
    expect(run(insertLink, before).text).toBe(after);
  });
});

describe("indentLines", () => {
  it.each([
    ["te|a", "  te|a"],
    ["|", "  |"],
    ["- te|a", "  - te|a"],
    ["> - te|a", ">   - te|a"],
    ["«one\n\ntwo»", "  «one\n\n  two»"],
  ])("turns %j into %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it.each([
    // Under the item above, at its text, as Markdown nests a list item.
    ["- a\n- |b", "- a\n  - |b"],
    ["* a\n\n* |b", "* a\n\n  * |b"],
    ["- [ ] a\n- [ ] |b", "- [ ] a\n  - [ ] |b"],
    ["1) a\n- |b", "1) a\n   - |b"],
    ["> 1) a\n> - |b", "> 1) a\n>    - |b"],
    ["1. a\nlazy\n- |b", "1. a\nlazy\n   - |b"],
    // One past the marker when nothing, or code, follows it.
    ["-   \n- |b", "-   \n  - |b"],
    ["-      a\n- |b", "-      a\n  - |b"],
    // Past the lines nested under it.
    ["- a\n  - b\n  - |c", "- a\n  - b\n    - |c"],
    // One indent unit when no item sits above it in its list.
    ["text\n1. |a", "text\n  1. |a"],
    ["- a\n  - |b", "- a\n    - |b"],
    ["1. a\n> - |b", "1. a\n>   - |b"],
    ["- a\n```\n- foo\n```\n- |b", "- a\n```\n- foo\n```\n  - |b"],
  ])("nests %j as %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it.each([
    // A new numbered list starts at 1, or it would be text of the item above.
    ["1. a\n2. |b", "1. a\n   1. |b"],
    ["1) a\n2) |b", "1) a\n   1) |b"],
    ["10. a\n11. |b", "10. a\n    1. |b"],
    ["1.   a\n2. |b", "1.   a\n     1. |b"],
    ["1. a\n   - x\n2. |b", "1. a\n   - x\n   1. |b"],
    ["1. a\n   1) x\n2. |b", "1. a\n   1) x\n   1. |b"],
    ["> [!note]\n> 1. a\n> 2. |b", "> [!note]\n> 1. a\n>    1. |b"],
    // Joining the numbered list the item above holds, it keeps its number.
    ["1. a\n   1. x\n2. |b", "1. a\n   1. x\n   2. |b"],
    // As does a number that Markdown already reads as 1.
    ["1. a\n01. |b", "1. a\n   01. |b"],
  ])("numbers %j as %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it.each([
    "1. a\n2. |b",
    "10. a\n11. |b",
    "1) a\n2) |b",
    "> [!note]\n> 1. a\n> 2. |b",
  ])("nests %j as a list in the item above, as Markdown renders it", (text) => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkGfm] }, text),
    );
    const nested = renderToStaticMarkup(
      createElement(
        Markdown,
        { remarkPlugins: [remarkGfm] },
        run(indentLines, text).state.sliceDoc(),
      ),
    );

    expect(html).not.toMatch(/<li>a\s*<ol>/);
    expect(nested).toMatch(/<li>a\s*<ol>\s*<li>b<\/li>\s*<\/ol>\s*<\/li>/);
  });

  it.each([
    // As Obsidian indents its lists, by default: with tabs.
    ["- a\n\t- b\n- |c", "- a\n\t- b\n\t- |c"],
    ["- a\n- |b\n\t- c", "- a\n\t- |b\n\t- c"],
    ["- a\n\t- b\n\t- |c", "- a\n\t- b\n\t\t- |c"],
    ["- a\n\t- |b", "- a\n\t\t- |b"],
    ["- a\n\t|more", "- a\n\t\t|more"],
    // Tab stops count from the line's start, quote markers included.
    ["> 1.  a\n> \t- |b", "> 1.  a\n> \t\t- |b"],
    ["- x\n\t- p\n      - a\n      - |b", "- x\n\t- p\n      - a\n\t\t- |b"],
    // As many as reach the text of a wide item above.
    ["1. p\n\t100. a\n\t- |b", "1. p\n\t100. a\n\t\t\t- |b"],
    ["1. p\n\t100. a\n\t101. |b", "1. p\n\t100. a\n\t\t\t1. |b"],
    // Never after spaces: the indent is tabs alone.
    ["- a\n\t- x\n  - |b", "- a\n\t- x\n\t\t- |b"],
  ])("indents with tabs a list that has some: %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it.each([
    // Lines the parser reads apart, which a tap must not break on.
    [">  -", "* b", ">>  1.", ">   \t> - q"],
    ["- a", ">  - b", "-", "  1. c"],
  ])("never fails, wherever the cursor is: %j", (...lines) => {
    const text = lines.join("\n");
    for (let at = 0; at <= text.length; at++) {
      const state = open(`|${text}`).update({
        selection: { anchor: at },
      }).state;
      expect(() => run(indentLines, state)).not.toThrow();
      expect(() => run(outdentLines, state)).not.toThrow();
    }
  });

  it("indents an item deep in quotes at once", () => {
    // Each line's quote marks sit between the list's items.
    const quotes = ">".repeat(16_000);
    const state = open(`${quotes} - a\n${quotes} - |b`);
    ensureSyntaxTree(state, state.doc.length, 60_000);
    const started = performance.now();

    const { text } = run(indentLines, state);

    expect(performance.now() - started).toBeLessThan(500);
    expect(text.endsWith(" - a\n" + quotes + "   - |b")).toBe(true);
  });

  it("indents with spaces a list whose text alone has a tab", () => {
    expect(run(indentLines, "- a\n\n\tmore\n- |b").text).toBe(
      "- a\n\n\tmore\n  - |b",
    );
  });

  it("moves every selected line as far as the first, keeping their nesting", () => {
    expect(run(indentLines, "1. a\n«2. b\n   - c»").text).toBe(
      "1. a\n   «1. b\n      - c»",
    );
  });

  it.each([
    // Each line keeps its own kind of indent, tabs first.
    ["- a\n\t«- b\n  text»", "- a\n\t\t«- b\n      text»"],
    ["1. a\n«2. b\n\tmore»", "1. a\n   «1. b\n\t   more»"],
    // A line without one takes the list's.
    ["- a\n\t- x\n«- b\n- c»", "- a\n\t- x\n\t«- b\n\t- c»"],
  ])("moves the other lines as many columns: %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });
});

describe("outdentLines", () => {
  it.each([
    ["  te|a", "te|a"],
    ["   te|a", " te|a"],
    ["\tte|a", "te|a"],
    ["te|a", "te|a"],
    [">   - te|a", "> - te|a"],
    ["> - te|a", "> - te|a"],
    ["«  one\n  \n  two»", "«one\n  \ntwo»"],
  ])("turns %j into %j", (before, after) => {
    expect(run(outdentLines, before).text).toBe(after);
  });

  it.each([
    // Back to the item it is nested under, past its siblings.
    ["1. a\n   2. |b", "1. a\n2. |b"],
    ["10. a\n    11. |b", "10. a\n11. |b"],
    ["1. a\n   - b\n   - |c", "1. a\n   - b\n- |c"],
    ["- a\n  - b\n\n    - |c", "- a\n  - b\n\n  - |c"],
    ["- a\n  - b\n  - c\n    - d\n  - |e", "- a\n  - b\n  - c\n    - d\n- |e"],
    ["- a\n\t- b\n\t\t- |c", "- a\n\t- b\n\t- |c"],
    ["- a\n  - b\n\t- |c", "- a\n  - b\n  - |c"],
    ["> 1. a\n>    2. |b", "> 1. a\n> 2. |b"],
    // Any other line, one level: an indent unit, or a tab.
    ["- a\n  |more", "- a\n|more"],
    ["1. a\n   |more", "1. a\n |more"],
    ["10. a\n\n    |para", "10. a\n\n  |para"],
    [
      "- a\n  ```\n      |code\n  ```\nafter",
      "- a\n  ```\n    |code\n  ```\nafter",
    ],
    ["text\n    |more", "text\n  |more"],
    ["  - a\n|lazy", "  - a\n|lazy"],
    // From the first selected line that has an indent.
    ["«- a\n  - b\n  - c»", "«- a\n- b\n- c»"],
  ])("outdents %j as %j", (before, after) => {
    expect(run(outdentLines, before).text).toBe(after);
  });

  it("moves every selected line back as far as the first, never past its start", () => {
    expect(run(outdentLines, "1. a\n   «2. b\n      - c»").text).toBe(
      "1. a\n«2. b\n   - c»",
    );
    expect(run(outdentLines, "- a\n  «- b\nc»").text).toBe("- a\n«- b\nc»");
    expect(run(outdentLines, "- a\n    «- b\n\tc»").text).toBe("- a\n«- b\nc»");
    // A tab cut part way leaves the spaces before the column reached.
    expect(run(outdentLines, "- a\n  - b\n    «- c\n\td»").text).toBe(
      "- a\n  - b\n  «- c\n  d»",
    );
    expect(run(outdentLines, "- a\n\t- b\n\t\t«- c\n\t\t\td»").text).toBe(
      "- a\n\t- b\n\t«- c\n\t\td»",
    );
  });

  it("outdents lines of any indent at once", () => {
    // Without the Markdown parser, which takes long over such an indent when
    // the note opens: only the command is timed.
    const spaces = " ".repeat(100_000);
    const doc = `${spaces}\ta\n${spaces}b\n${spaces}\tc`;
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    });
    const started = performance.now();

    const { text } = run(outdentLines, state);

    expect(performance.now() - started).toBeLessThan(1000);
    // Compared as a whole: a failure would diff 200,000 characters. The line
    // with a tab is rebuilt in tabs.
    const tabs = "\t".repeat(25_000);
    expect(text === `«${spaces}a\n${spaces.slice(4)}b\n${tabs}c»`).toBe(true);
  });
});

describe("the formatting commands", () => {
  const commands = {
    cycleHeading,
    toggleBold,
    toggleList,
    cycleTask,
    insertLink,
    indentLines,
    outdentLines,
  };

  it.each(Object.entries(commands))(
    "%s keeps the file's line breaks and adds none",
    (_, command) => {
      const { state } = run(
        command,
        EditorState.create({
          doc: "one\r\ntwo",
          selection: { anchor: 0, head: 7 },
          extensions: [EditorState.lineSeparator.of("\r\n")],
        }),
      );

      expect(state.sliceDoc().split("\r\n")).toHaveLength(2);
      expect(state.sliceDoc().replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    },
  );

  it.each(Object.entries(commands))(
    "%s is an edit of its own for undo, even with typing right after it",
    (_, command) => {
      const { state } = run(command, open("|one", [history()]));
      let undone = state.update({
        changes: { from: state.selection.main.head, insert: "x" },
        userEvent: "input.type",
      }).state;
      const undoOnce = () =>
        undo({
          state: undone,
          dispatch(transaction) {
            undone = transaction.state;
          },
        });

      undoOnce();
      expect(undone.sliceDoc()).toBe(state.sliceDoc());
      undoOnce();
      expect(undone.sliceDoc()).toBe("one");
    },
  );

  it.each(Object.entries(commands))(
    "%s changes nothing in a read-only editor",
    (_, command) => {
      const state = open("«one»", [EditorState.readOnly.of(true)]);

      expect(command({ state, dispatch: () => undefined })).toBe(false);
    },
  );
});
