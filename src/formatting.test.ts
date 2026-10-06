// @vitest-environment node
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
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
    ["1. a\n2. |b", "1. a\n   2. |b"],
    ["1) a\n- |b", "1) a\n   - |b"],
    ["10. a\n11. |b", "10. a\n    11. |b"],
    ["1.   a\n2. |b", "1.   a\n     2. |b"],
    // One past the marker when nothing, or code, follows it.
    ["-   \n- |b", "-   \n  - |b"],
    ["-      a\n- |b", "-      a\n  - |b"],
    // Past the lines nested under it.
    ["1. a\n   - b\n2. |c", "1. a\n   - b\n   2. |c"],
    ["- a\n  - b\n  - |c", "- a\n  - b\n    - |c"],
    // In a quote or a callout, after its markers.
    ["> [!note]\n> 1. a\n> 2. |b", "> [!note]\n> 1. a\n>    2. |b"],
    // One indent unit when no item sits above at the same indent.
    ["text\n1. |a", "text\n  1. |a"],
    ["- a\n  - |b", "- a\n    - |b"],
    ["1. a\ntext\n2. |b", "1. a\ntext\n  2. |b"],
    ["1. a\n> - |b", "1. a\n>   - |b"],
  ])("nests %j as %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it.each([
    // As Obsidian indents its lists, by default.
    ["- a\n\t- b\n- |c", "- a\n\t- b\n\t- |c"],
    ["\t- a\n\t- |b", "\t- a\n\t\t- |b"],
    ["- a\n\t- |b", "- a\n\t\t- |b"],
    ["\t- a\n      - b\n    - |c", "\t- a\n      - b\n    \t- |c"],
  ])("indents with a tab a list that has tabs: %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it("moves every selected line as far as the first, keeping their nesting", () => {
    expect(run(indentLines, "1. a\n«2. b\n   - c»").text).toBe(
      "1. a\n   «2. b\n      - c»",
    );
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
    ["> 1. a\n>    2. |b", "> 1. a\n> 2. |b"],
    // One level when no item sits above it.
    ["text\n    |more", "text\n  |more"],
  ])("outdents %j as %j", (before, after) => {
    expect(run(outdentLines, before).text).toBe(after);
  });

  it("moves every selected line back as far as the first, never past its start", () => {
    expect(run(outdentLines, "1. a\n   «2. b\n      - c»").text).toBe(
      "1. a\n«2. b\n   - c»",
    );
    expect(run(outdentLines, "- a\n  «- b\nc»").text).toBe("- a\n«- b\nc»");
    expect(run(outdentLines, "- a\n    «- b\n\tc»").text).toBe("- a\n«- b\nc»");
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
