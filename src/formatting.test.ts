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
  cycleTask,
  formatsAt,
  HEADINGS,
  indentLines,
  insertLink,
  makeCallout,
  outdentLines,
  quoteAs,
  quoteLines,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleList,
  toggleNumbered,
  toggleQuote,
  toggleStrikethrough,
  TOGGLE_HEADINGS,
  writeTable,
} from "./formatting.ts";
import { withFrontmatter } from "./frontmatter.ts";

function heading(level: number): StateCommand {
  const command = TOGGLE_HEADINGS[level - 1];
  if (!command) throw new Error(`No Heading ${String(level)}`);
  return command;
}

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

/** Runs a command that is off, which writes nothing. */
function off(command: StateCommand, text: string | EditorState) {
  const state = typeof text === "string" ? open(text) : text;
  let dispatched = false;
  const done = command({
    state,
    dispatch() {
      dispatched = true;
    },
  });
  expect(done).toBe(false);
  expect(dispatched).toBe(false);
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

describe("TOGGLE_HEADINGS", () => {
  it.each([
    [1, "|plan", "# |plan"],
    [2, "pl|an", "## pl|an"],
    [3, "# pl|an", "### pl|an"],
    [1, "### pl|an", "# pl|an"],
    [1, "#### pl|an", "# pl|an"],
    [2, "## pl|an", "pl|an"],
    [3, "###\tpl|an", "pl|an"],
    [2, "#\tpl|an", "##\tpl|an"],
    [1, "|", "# |"],
    [2, "#|", "##|"],
    [3, "> pl|an", "> ### pl|an"],
    [1, "#tag|", "# #tag|"],
    [2, "1. Fre|eze", "1. ## Fre|eze"],
    [1, "- ## pl|an", "- # pl|an"],
    [2, "- ## pl|an", "- pl|an"],
    [3, "> - pl|an", "> - ### pl|an"],
    [1, "  12) |", "  12) # |"],
  ])("Heading %i turns %j into %j", (level, before, after) => {
    expect(run(heading(level), before).text).toBe(after);
  });

  it("gives every selected line the level, or text when all have it", () => {
    expect(run(heading(3), "«## one\n\ntwo\n# three»").text).toBe(
      "«### one\n\n### two\n### three»",
    );
    expect(run(heading(2), "## o«ne\n# two»").text).toBe("## o«ne\n## two»");
    expect(run(heading(2), "## o«ne\n\n## two»").text).toBe("o«ne\n\ntwo»");
    expect(run(heading(1), "«one\n# two»").text).toBe("# «one\n# two»");
  });

  it("is on in a heading of its level", () => {
    const on = (marked: string) =>
      TOGGLE_HEADINGS.map((command) => formatsAt(open(marked)).on.has(command));
    expect(on("## pl|an")).toEqual([false, true, false]);
    expect(on("pl|an")).toEqual([false, false, false]);
    expect(on("#### pl|an")).toEqual([false, false, false]);
    expect(on("1. ## pl|an")).toEqual([false, true, false]);
  });

  it("makes a list item's heading, which the viewer renders in it", () => {
    const { text } = run(heading(2), "1. Fre|eze\n2. Ship");
    expect(text).toBe("1. ## Fre|eze\n2. Ship");
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: [remarkGfm] }, "1. ## Freeze"),
    );
    expect(html).toContain("<li>\n<h2>Freeze</h2>\n</li>");
  });

  it("leaves a task alone, which holds no heading", () => {
    off(heading(1), "- [ ] Pa|ck");
    expect(run(heading(1), "«one\n- [x] two»").text).toBe("# «one\n- [x] two»");
    expect(formatsAt(open("- [ ] Pa|ck")).off.has(heading(1))).toBe(true);
  });

  it.each([
    "```sh\n## comm|ent\n```",
    "``|`sh\n## comment\n```",
    "    ## co|de",
    "> ```\n> ## co|de\n> ```",
  ])("is off in code: %j", (text) => {
    for (const command of [...TOGGLE_HEADINGS, ...HEADINGS]) off(command, text);
    const formats = formatsAt(open(text));
    expect(formats.heading).toBe(0);
    expect(TOGGLE_HEADINGS.some((command) => formats.on.has(command))).toBe(
      false,
    );
    expect(HEADINGS.every((command) => formats.off.has(command))).toBe(true);
  });

  it("leaves code alone among the selected lines", () => {
    expect(run(heading(2), "«one\n```\n# two\n```\nthree»").text).toBe(
      "## «one\n```\n# two\n```\n## three»",
    );
    expect(
      run(HEADINGS[0] ?? heading(1), "«# one\n```\n# two\n```»").text,
    ).toBe("«one\n```\n# two\n```»");
  });

  it("is off in the front matter", () => {
    const state = EditorState.create({
      doc: "---\ntitle: Tea\n---\nmilk",
      selection: { anchor: 6 },
      extensions: withFrontmatter(markdown({ base: markdownLanguage })),
    });
    off(heading(1), state);
    off(toggleList, state);
    expect(formatsAt(state).off.has(heading(1))).toBe(true);
  });
});

describe("HEADINGS", () => {
  it.each([
    [0, "1. ## Free|ze", "1. Free|ze"],
    [0, "> - ### pl|an", "> - pl|an"],
    [4, "- ## pl|an", "- #### pl|an"],
    [6, "1. pl|an", "1. ###### pl|an"],
  ])("style %i turns %j into %j", (level, before, after) => {
    const command = HEADINGS[level];
    if (!command) throw new Error(`No style ${String(level)}`);
    expect(run(command, before).text).toBe(after);
  });
});

describe("writeTable", () => {
  // Its rows, after the quotes' marks of the line it comes after.
  const table = (marks = "") =>
    ["|  |  |", "| --- | --- |", "|  |  |"].map((row) => marks + row);
  /** The text it leaves, and where the cursor is in it. */
  const written = (from: string | EditorState) => {
    const { state } = run(writeTable, from);
    return [state.sliceDoc(), state.selection.main.head] as const;
  };
  // The text, the cursor in the first cell of its first table.
  const at = (text: string) => [text, text.indexOf("|  |") + 2] as const;

  it.each([
    ["on an empty note", "|", table().join("\n")],
    [
      "after a line of text, a blank line apart",
      "t|ea",
      ["tea", "", ...table()].join("\n"),
    ],
    [
      "between two paragraphs, a blank line apart from each",
      "tea|\n\nmilk",
      ["tea", "", ...table(), "", "milk"].join("\n"),
    ],
    [
      "after the paragraph, never between its lines",
      "tea|\nmilk",
      ["tea", "milk", "", ...table()].join("\n"),
    ],
    [
      "after a setext heading's underline",
      "Te|a\n---\nmilk",
      ["Tea", "---", "", ...table(), "", "milk"].join("\n"),
    ],
    [
      "after a quote's lazy line",
      "> t|ea\nmilk",
      ["> tea", "milk", "", ...table()].join("\n"),
    ],
    [
      "after a list item's lines",
      "- t|ea\n  milk",
      ["- tea", "  milk", "", ...table()].join("\n"),
    ],
    [
      "on a blank line between text, apart from each",
      "tea\n|\nmilk",
      ["tea", "", ...table(), "", "milk"].join("\n"),
    ],
    [
      "on a blank line between blank lines, there",
      "tea\n\n|\n\nmilk",
      ["tea", "", ...table(), "", "milk"].join("\n"),
    ],
    [
      "after the last selected line",
      "«tea\n\nmi»lk\n\nbread",
      ["tea", "", "milk", "", ...table(), "", "bread"].join("\n"),
    ],
    [
      "after the last selected line, not the next one's start",
      "«tea\n»\nmilk",
      ["tea", "", ...table(), "", "milk"].join("\n"),
    ],
    [
      "in a quote, after its marks",
      "> > t|ea\n> >\n> > milk",
      ["> > tea", "> >", ...table("> > "), "> >", "> > milk"].join("\n"),
    ],
    [
      "on a quote's blank line",
      "> tea\n> |",
      ["> tea", ">", ...table("> ")].join("\n"),
    ],
    [
      "in a callout",
      "> [!note] Plan\n> te|a",
      ["> [!note] Plan", "> tea", ">", ...table("> ")].join("\n"),
    ],
  ])("writes an empty table %s, its first cell edited", (_, before, after) => {
    expect(written(before)).toEqual(at(after));
  });

  it("comes after the table it is in, not between its rows", () => {
    const state = EditorState.create({
      doc: "| a |\n| - |\n| b |\n\ntea",
      selection: { anchor: 2 },
      extensions: markdown({ base: markdownLanguage }),
    });
    expect(written(state)).toEqual(
      at(["| a |", "| - |", "| b |", "", ...table(), "", "tea"].join("\n")),
    );
  });

  it("writes the note's own line endings", () => {
    const state = open("tea|", [EditorState.lineSeparator.of("\r\n")]);
    expect(written(state)).toEqual(at(["tea", "", ...table()].join("\r\n")));
  });

  it("is one edit, which undo takes back", () => {
    const { state } = run(writeTable, open("tea|\nmilk", [history()]));
    let back = state;
    undo({
      state,
      dispatch: (transaction) => {
        back = transaction.state;
      },
    });
    expect(marked(back)).toBe("tea|\nmilk");
  });

  it("is off in the front matter", () => {
    const state = (anchor: number) =>
      EditorState.create({
        doc: "---\ntitle: Tea\n---\nmilk",
        selection: { anchor },
        extensions: withFrontmatter(markdown({ base: markdownLanguage })),
      });
    for (const anchor of [1, 6, 16]) {
      expect(
        writeTable({ state: state(anchor), dispatch: () => undefined }),
      ).toBe(false);
      expect(formatsAt(state(anchor)).tableOff).toBe(true);
    }
    expect(formatsAt(state(21)).tableOff).toBe(false);
  });

  it("is off in a code block", () => {
    for (const text of [
      "```\nco|de\n```",
      "    co|de",
      "``|`\ncode\n```",
      "> ```\n> co|de\n> ```",
    ]) {
      const state = open(text);
      expect(writeTable({ state, dispatch: () => undefined })).toBe(false);
      expect(formatsAt(state).tableOff).toBe(true);
    }
    expect(formatsAt(open("```\ncode\n```\nte|a")).tableOff).toBe(false);
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

describe("toggleItalic", () => {
  it.each([
    ["a «word» b", "a *«word»* b"],
    ["a |b", "a *|*b"],
    ["a *|*b", "a |b"],
    ["a *wo|rd* b", "a wo|rd b"],
    ["a _wo|rd_ b", "a wo|rd b"],
    ["a *word|* b", "a *word*| b"],
    ["a ***wo|rd*** b", "a **wo|rd** b"],
    ["a **«word»** b", "a ***«word»*** b"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleItalic, before).text).toBe(after);
  });
});

describe("toggleStrikethrough", () => {
  it.each([
    ["a «word» b", "a ~~«word»~~ b"],
    ["a |b", "a ~~|~~b"],
    ["a ~~|~~b", "a |b"],
    ["a ~~wo|rd~~ b", "a wo|rd b"],
    ["a ~~word|~~ b", "a ~~word~~| b"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleStrikethrough, before).text).toBe(after);
  });
});

describe("toggleCode", () => {
  it.each([
    ["a «word» b", "a `«word»` b"],
    ["a |b", "a `|`b"],
    ["a `|`b", "a |b"],
    ["a `wo|rd` b", "a wo|rd b"],
    ["a ``wo|rd`` b", "a wo|rd b"],
    ["a `word|` b", "a `word`| b"],
    ["a «x`y» b", "a ``«x`y»`` b"],
    ["a «`y» b", "a `` «`y» `` b"],
    ["a `` `y| `` b", "a `y| b"],
    ["a ` | ` b", "a  |  b"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleCode, before).text).toBe(after);
  });
});

describe("toggleNumbered", () => {
  it.each([
    ["te|a", "1. te|a"],
    ["«a\nb\nc»", "1. «a\n2. b\n3. c»"],
    ["«- a\n- b»", "«1. a\n2. b»"],
    ["«1. a\n2. b»", "«a\nb»"],
    ["«- a\n\n9) b»", "«1. a\n\n2) b»"],
    ["> - te|a", "> 1. te|a"],
    ["- [ ] te|a", "1. [ ] te|a"],
    // What a widened item holds moves with its text, and stays in it.
    ["«- a\n  - b\n  - c\n- d»", "«1. a\n   1. b\n   2. c\n2. d»"],
    ["- a|\n  - b\n\n  more", "1. a|\n   - b\n\n   more"],
    ["- a|\n\tb", "1. a|\n\t b"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleNumbered, before).text).toBe(after);
  });
});

describe("toggleQuote", () => {
  it.each([
    ["te|a", "> te|a"],
    ["> te|a", "te|a"],
    [">te|a", "te|a"],
    ["> > te|a", "> te|a"],
    ["  > te|a", "  te|a"],
    ["- te|a", "> - te|a"],
    ["«a\n\nb»", "> «a\n>\n> b»"],
    ["«> a\nb»", "«> a\n> b»"],
    ["«> a\n>\n> b»", "«a\n\nb»"],
    // A line not quoted takes its whole block.
    ["a\nb|\nc", "> a\n> b|\n> c"],
    ["Tit|le\n===", "> Tit|le\n> ==="],
    ["- a\n|\n- b", "> - a\n>|\n> - b"],
    // A blank line apart from the text around, unselected.
    ["> quote\n|\nnext", "> quote\n\n>|\n\nnext"],
    ["a\n|\nb", "a\n\n>|\n\nb"],
    ["> q\n# Hea|d", "> q\n\n> # Hea|d"],
    ["te|a\n> [!tip] cup", "> te|a\n\n> [!tip] cup"],
  ])("turns %j into %j", (before, after) => {
    expect(run(toggleQuote, before).text).toBe(after);
  });

  it("quotes a table whole from one of its rows", () => {
    const { text } = run(
      toggleQuote,
      EditorState.create({
        doc: "| a |\n| - |\n| b |",
        selection: { anchor: 14, head: 15 },
        extensions: [markdown({ base: markdownLanguage })],
      }),
    );

    expect(text).toBe("> | a |\n> | - |\n> | «b» |");
  });
});

describe("makeCallout", () => {
  it.each([
    // Lines not quoted: the first one's text becomes the title.
    ["te|a", "> [!warning] te|a"],
    ["|", "> [!warning] |"],
    ["«a\nb»", "> [!warning] «a\n> b»"],
    ["«a\n\nb»", "> [!warning] «a\n>\n> b»"],
    // A block that is not a paragraph keeps its line, under a title's.
    ["- te|a", "> [!warning]\n> - te|a"],
    ["# Ti|tle", "> [!warning]\n> # Ti|tle"],
    // Up to a quote, which it never takes in.
    ["«a\n\n> [!tip] b»", "> [!warning] «a\n\n> [!tip] b»"],
    // A quote: its first line's.
    ["> te|a", "> [!warning] te|a"],
    [">te|a", ">[!warning] te|a"],
    ["> a\n> b|", "> [!warning] a\n> b|"],
    ["- > te|a", "- > [!warning] te|a"],
    ["> a\n>|", "> [!warning] a\n>|"],
    [">|\n\nb", "> [!warning] |\n\nb"],
    [
      "> ```js\n> x\n> ```\n> te|a",
      "> [!warning]\n> ```js\n> x\n> ```\n> te|a",
    ],
    ["- > - te|a", "- > [!warning]\n  > - te|a"],
    // Only the quote around the first line.
    ["«> a\nb»", "«> [!warning] a\nb»"],
    ["«> [!tip] a\n\n> [!bug] b»", "«> [!warning] a\n\n> [!bug] b»"],
    // A callout: only its type's name.
    ["> [!note] Ti|tle", "> [!warning] Ti|tle"],
    ["> [!NOTE]- Ti|tle\n> body", "> [!warning]- Ti|tle\n> body"],
    ["> [!note]+\n> bo|dy", "> [!warning]+\n> bo|dy"],
    ["> [!faq] te|a", "> [!warning] te|a"],
    // The innermost quote around the line.
    ["> [!note] T\n> bo|dy", "> [!warning] T\n> bo|dy"],
    ["> [!note]\n> > [!tip] in|ner", "> [!note]\n> > [!warning] in|ner"],
    ["> [!note] T\n> > qu|ote", "> [!note] T\n> > [!warning] qu|ote"],
    // A blank line apart from the blocks around it.
    ["> quote\n|\nnext", "> quote\n\n> [!warning] |\n\nnext"],
    ["a\n|\nb", "a\n\n> [!warning] |\n\nb"],
    ["> q\n# Hea|d", "> q\n\n> [!warning]\n> # Hea|d"],
    ["te|a\n> [!tip] cup", "> [!warning] te|a\n\n> [!tip] cup"],
    // The whole block the cursor is in.
    ["a\nb|\nc", "> [!warning] a\n> b|\n> c"],
    ["Tit|le\n===", "> [!warning]\n> Tit|le\n> ==="],
    ["- a\n|\n- b", "> [!warning]\n> - a\n>|\n> - b"],
    // The first cursor's lines alone.
    ["on|e\n\ntwo|", "> [!warning] on|e\n\ntwo|"],
  ])("turns %j into %j", (before, after) => {
    expect(run(makeCallout("warning"), before).text).toBe(after);
  });

  it("takes a table whole from its last row", () => {
    const { text } = run(
      makeCallout("warning"),
      EditorState.create({
        doc: "| a |\n| - |\n| b |",
        selection: { anchor: 14, head: 15 },
        extensions: [markdown({ base: markdownLanguage })],
      }),
    );

    expect(text).toBe("> [!warning]\n> | a |\n> | - |\n> | «b» |");
  });

  it("makes the callout that Quote then a type make, as on a phone", () => {
    for (const text of [
      "> quote\n|\nnext",
      "a\n|\nb",
      "> q\n# Hea|d",
      "te|a\n> [!tip] cup",
      "Tit|le\n===",
      "- a\n|\n- b",
    ]) {
      const quoted = run(quoteLines, text).state;

      expect(run(quoteAs("warning"), quoted).text).toBe(
        run(makeCallout("warning"), text).text,
      );
    }
  });

  it("writes a table's rows under a title line of their own", () => {
    const { text } = run(
      makeCallout("warning"),
      EditorState.create({
        doc: "| a |\n| - |",
        selection: { anchor: 0, head: 11 },
        extensions: [markdown({ base: markdownLanguage })],
      }),
    );

    expect(text).toBe("> [!warning]\n> «| a |\n> | - |»");
  });

  it("writes nothing where the callout already shows as the type", () => {
    for (const [text, type] of [
      ["> [!faq] te|a", "question"],
      ["> [!question] te|a", "question"],
      ["> [!whatever] te|a", "note"],
    ] as const) {
      const state = open(text);
      const dispatched: Transaction[] = [];
      const done = makeCallout(type)({
        state,
        dispatch: (transaction) => dispatched.push(transaction),
      });

      expect(done).toBe(true);
      expect(dispatched).toEqual([]);
    }
  });

  it("is off in code and in the front matter", () => {
    for (const text of ["```\nco|de\n```", "> ```\n> co|de\n> ```"]) {
      const state = open(text);
      expect(makeCallout("tip")({ state, dispatch: () => undefined })).toBe(
        false,
      );
      expect(formatsAt(state).calloutOff).toBe(true);
    }
    const front = EditorState.create({
      doc: "---\ntitle: Tea\n---\nTea.",
      selection: { anchor: 6 },
      extensions: [withFrontmatter(markdown({ base: markdownLanguage }))],
    });
    expect(
      makeCallout("tip")({ state: front, dispatch: () => undefined }),
    ).toBe(false);
    expect(formatsAt(front).calloutOff).toBe(true);
    expect(formatsAt(open("te|a")).calloutOff).toBe(false);
  });

  it("is the type checked where the cursor's line is in a callout", () => {
    const callout = (text: string) => formatsAt(open(text)).callout;

    expect(callout("te|a")).toBeNull();
    expect(callout("> te|a")).toBeNull();
    expect(callout("> [!tip] te|a")).toBe("tip");
    expect(callout("> [!FAQ]-\n> te|a")).toBe("question");
    expect(callout("> [!whatever]\n> te|a")).toBe("note");
    expect(callout("> [!note]\n> > [!bug]\n> > te|a")).toBe("bug");
    expect(callout("> [!note]\n> > te|a")).toBeNull();
    expect(callout(">\n> [!tip] te|a")).toBe("tip");
    expect(callout("> te|a\n> [!tip]")).toBeNull();
  });
});

describe("quoteLines", () => {
  it.each([
    ["te|a", "> te|a"],
    ["«a\n> b»", "> «a\n> b»"],
    ["«a\n\nb»", "> «a\n>\n> b»"],
  ])("turns %j into %j", (before, after) => {
    expect(run(quoteLines, before).text).toBe(after);
  });

  it("never takes a quote away", () => {
    const dispatched: Transaction[] = [];
    const done = quoteLines({
      state: open("«> a\n> b»"),
      dispatch: (transaction) => dispatched.push(transaction),
    });

    expect(done).toBe(true);
    expect(dispatched).toEqual([]);
  });
});

describe("quoteAs", () => {
  it.each([
    // The plain quote: lines not quoted become one, as Quote does.
    ["te|a", "quote", "> te|a"],
    // A plain quote goes, whole, as text again.
    ["> te|a", "quote", "te|a"],
    ["> a\n> b|", "quote", "a\nb|"],
    [">a\n>\n> b|", "quote", "a\n\nb|"],
    ["- > te|a", "quote", "- te|a"],
    ["> [!note] T\n> > in|ner", "quote", "> [!note] T\n> in|ner"],
    // A callout becomes a plain quote: its `[!type]` and fold sign go, its
    // title staying as the quote's first line, or its line, if it has none.
    ["> [!tip] Brew it|", "quote", "> Brew it|"],
    ["> [!tip]- Brew it|\n> body", "quote", "> Brew it|\n> body"],
    ["> [!tip]\n> bo|dy", "quote", "> bo|dy"],
    ["> [!tip]\n> - it|em", "quote", "> - it|em"],
    ["> [!tip] |", "quote", "> |"],
    ["> [!note] T\n> > [!tip] in|ner", "quote", "> [!note] T\n> > in|ner"],
    // The callout's own type: the callout goes, whole, as text again.
    ["> [!tip] Brew it|", "tip", "Brew it|"],
    ["> [!tip]- Brew|\n> body", "tip", "Brew|\nbody"],
    ["> [!tip]\n> - it|em", "tip", "- it|em"],
    ["> [!tip] T\n>\n> bo|dy", "tip", "T\n\nbo|dy"],
    ["> [!TIP] te|a", "tip", "te|a"],
    ["> [!hint] te|a", "tip", "te|a"],
    ["> [!whatever] te|a", "note", "te|a"],
    ["> [!note] T\n> > [!tip] in|ner", "tip", "> [!note] T\n> in|ner"],
    ["> [!tip] T|\n> > inner", "tip", "T|\n> inner"],
    // Each line's own marks, in a paragraph's later lines too.
    [
      "> [!note] T\n> > in|ner\n> > more",
      "quote",
      "> [!note] T\n> in|ner\n> more",
    ],
    ["> [!tip] T|\n> > inner\n> > more", "tip", "T|\n> inner\n> more"],
    ["> [!tip] T|\n> > inner\n> more", "tip", "T|\n> inner\nmore"],
    // What comes before the quote on its first line stays.
    ["- > [!tip]\n  > bo|dy", "quote", "- > bo|dy"],
    ["- > [!tip]\n  > bo|dy", "tip", "- bo|dy"],
    ["> [!note] T\n> > [!tip]\n> > in|ner", "quote", "> [!note] T\n> > in|ner"],
    // Another type: as the callout types' menu makes it.
    ["te|a", "tip", "> [!tip] te|a"],
    ["> te|a", "tip", "> [!tip] te|a"],
    ["> [!note] te|a", "tip", "> [!tip] te|a"],
  ] as const)("turns %j, for %s, into %j", (before, target, after) => {
    expect(run(quoteAs(target), before).text).toBe(after);
  });

  it("is off in code and in the front matter", () => {
    for (const target of ["quote", "tip"] as const) {
      for (const text of ["```\nco|de\n```", "> ```\n> co|de\n> ```"]) {
        expect(
          quoteAs(target)({ state: open(text), dispatch: () => undefined }),
        ).toBe(false);
      }
    }
  });

  it("is the quote around the first selected line, which shows it pressed", () => {
    const quoted = (text: string) => formatsAt(open(text)).quoted;

    expect(quoted("te|a")).toBe(false);
    expect(quoted("> te|a")).toBe(true);
    expect(quoted("- > te|a")).toBe(true);
    expect(quoted("> [!tip] te|a")).toBe(true);
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

  it("keeps a heading in the item", () => {
    expect(run(toggleList, "## pl|an").text).toBe("- ## pl|an");
    expect(run(toggleNumbered, "- ## pl|an").text).toBe("1. ## pl|an");
    expect(run(toggleList, "- ## pl|an").text).toBe("## pl|an");
  });

  it("is off in code, which reads as text", () => {
    for (const command of [toggleList, toggleNumbered, cycleTask]) {
      off(command, "```\n- co|de\n```");
    }
    const formats = formatsAt(open("```\n- [ ] co|de\n```"));
    expect(formats.on.has(toggleList)).toBe(false);
    expect(formats.on.has(cycleTask)).toBe(false);
    expect(formats.off.has(toggleList)).toBe(true);
    expect(run(toggleList, "«one\n```\ntwo\n```»").text).toBe(
      "- «one\n```\ntwo\n```»",
    );
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

  it("leaves a heading alone, which a task cannot hold", () => {
    off(cycleTask, "## Ti|tle");
    off(cycleTask, "- ## Ti|tle");
    expect(run(cycleTask, "«one\n## two»").text).toBe("- [ ] «one\n## two»");
    expect(formatsAt(open("- ## Ti|tle")).off.has(cycleTask)).toBe(true);
    expect(formatsAt(open("- [ ] Ti|tle")).off.has(cycleTask)).toBe(false);
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
    ["1. a\n   > q\n2. |b", "1. a\n   > q\n   1. |b"],
    ["1. [ ] a\n2. |b", "1. [ ] a\n   1. |b"],
    // Joining the numbered list the item above holds, it keeps its number.
    ["1. a\n   1. x\n2. |b", "1. a\n   1. x\n   2. |b"],
    // As does a number that Markdown already reads as 1.
    ["1. a\n01. |b", "1. a\n   01. |b"],
    // And one that breaks into no text: after a blank line, a heading, a
    // fenced block or HTML.
    ["1. a\n\n2. |b", "1. a\n\n   2. |b"],
    ["1. # h\n2. |b", "1. # h\n   2. |b"],
    [
      "1. a\n   ```\n   x\n   ```\n2. |b",
      "1. a\n   ```\n   x\n   ```\n   2. |b",
    ],
    ["1. <div>\n2. |b", "1. <div>\n   2. |b"],
  ])("numbers %j as %j", (before, after) => {
    expect(run(indentLines, before).text).toBe(after);
  });

  it("nests a list that keeps its number after a blank line, as Markdown renders it", () => {
    const nested = renderToStaticMarkup(
      createElement(
        Markdown,
        { remarkPlugins: [remarkGfm] },
        run(indentLines, "1. a\n\n2. |b").state.sliceDoc(),
      ),
    );

    expect(nested).toMatch(/<p>a<\/p>\s*<ol start="2">\s*<li>/);
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

    expect(performance.now() - started).toBeLessThan(1000);
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
    // The first line's step goes before their own indent, which stays as
    // written, even where a tab then takes up the step.
    ["- a\n\t«- b\n  text»", "- a\n\t\t«- b\n\t  text»"],
    ["1. a\n«2. b\n\tmore»", "1. a\n   «1. b\n   \tmore»"],
    ["- a\n\t- x\n«- b\n- c»", "- a\n\t- x\n\t«- b\n\t- c»"],
    ["«- b\n  ```\n  \tx»\n  ```", "  «- b\n    ```\n    \tx»\n  ```"],
  ])("moves the other lines by the first one's step: %j", (before, after) => {
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
    // Whitespace goes from the start of their indent, a tab only whole.
    expect(run(outdentLines, "- a\n  - b\n    «- c\n\td»").text).toBe(
      "- a\n  - b\n  «- c\n\td»",
    );
    expect(run(outdentLines, "- a\n  - b\n    «- c\n \t  y»").text).toBe(
      "- a\n  - b\n  «- c\n\t  y»",
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
    // Compared as a whole: a failure would diff 300,000 characters.
    const back = spaces.slice(4);
    expect(text === `«${spaces}a\n${back}b\n${back}\tc»`).toBe(true);
  });
});

describe("the formatting commands", () => {
  const commands = {
    heading: heading(2),
    callout: makeCallout("warning"),
    quote: quoteAs("quote"),
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
          extensions: [
            EditorState.lineSeparator.of("\r\n"),
            markdown({ base: markdownLanguage }),
          ],
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
