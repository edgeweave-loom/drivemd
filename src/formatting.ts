import { isolateHistory } from "@codemirror/commands";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type SelectionRange,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/*
 * Markdown formatting, as the keyboard toolbar offers it on phones. Each
 * command is one edit that undo takes back alone, and changes only the
 * Markdown it adds or removes: no line break, and no other byte.
 */

// What comes before a line's own Markdown: quote markers, as in a quote or
// a callout, then its indent.
const QUOTES = /^(?:[ \t]*>[ \t]?)*/;
const INDENT = /^[ \t]*/;
// An ATX heading's hashes and the spaces after them.
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;
// A list item's marker and the spaces after it, then its task box if any.
const ITEM = /^([-+*]|\d{1,9}[.)])([ \t]+)(?:\[([ xX])\](?:[ \t]+|$))?/;

/** A line's Markdown at its start, after any quote markers and indent. */
function prefix(line: Line) {
  const quoted = line.text.replace(QUOTES, "");
  const rest = quoted.replace(INDENT, "");
  const lead = line.text.length - rest.length;
  const heading = HEADING.exec(rest);
  const item = ITEM.exec(rest);
  return {
    number: line.number,
    /** Where the line's own Markdown starts. */
    at: line.from + lead,
    blank: rest === "",
    /** How deep in quotes the line sits: its `>`, one each. */
    quotes: line.text
      .slice(0, line.text.length - quoted.length)
      .replace(/[^>]/g, ""),
    /** The line's indent, after any quote markers. */
    indent: quoted.slice(0, quoted.length - rest.length),
    heading: heading?.[1]?.length ?? 0,
    headingLength: heading?.[0].length ?? 0,
    marker: item?.[1],
    /** The spaces after a list item's marker. */
    gap: item?.[2] ?? "",
    /** Whether nothing follows a list item's marker. */
    bare: item?.[0].length === rest.length && item[3] === undefined,
    /** Where a task box starts, or would. */
    boxAt:
      line.from + lead + (item?.[1]?.length ?? 0) + (item?.[2]?.length ?? 0),
    box: item?.[3],
    itemLength: item?.[0].length ?? 0,
  };
}

type Prefix = ReturnType<typeof prefix>;

/**
 * The lines the selection touches, each once and in order. Blank lines are
 * left out of a selection that holds others: formatting them would only add
 * stray symbols.
 */
function selectedLines(state: EditorState): Prefix[] {
  const lines: Prefix[] = [];
  let last = 0;
  for (const range of state.selection.ranges) {
    for (let at = range.from; at <= range.to;) {
      const line = state.doc.lineAt(at);
      if (line.number > last && (range.empty || range.to > line.from)) {
        lines.push(prefix(line));
        last = line.number;
      }
      at = line.to + 1;
    }
  }
  const filled = lines.filter((line) => !line.blank);
  return filled.length > 0 ? filled : lines;
}

/** Applies the changes `format` makes to the selected lines. */
function formatLines(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  format: (lines: Prefix[]) => ChangeSpec[],
): boolean {
  if (state.readOnly) return false;
  const changes = state.changes(format(selectedLines(state)));
  dispatch(
    state.update({
      changes,
      // A cursor at the start of a line moves past the Markdown added there.
      selection: state.selection.map(changes, 1),
      scrollIntoView: true,
      userEvent: "input.format",
      // Typing right after it is another edit for undo.
      annotations: isolateHistory.of("after"),
    }),
  );
  return true;
}

/**
 * Turns the lines into headings one level down from the first line's, up
 * to the third, then back to text: `#`, `##`, `###`, none.
 */
export const cycleHeading: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const first = lines[0]?.heading ?? 0;
    const level = first >= 3 ? 0 : first + 1;
    return lines.flatMap((line): ChangeSpec[] => {
      const hashes = line.at + line.heading;
      if (line.heading === level) return [];
      if (line.heading === 0) {
        return [{ from: line.at, insert: `${"#".repeat(level)} ` }];
      }
      if (level === 0)
        return [{ from: line.at, to: line.at + line.headingLength }];
      return level > line.heading
        ? [{ from: hashes, insert: "#".repeat(level - line.heading) }]
        : [{ from: line.at + level, to: hashes }];
    });
  });

/**
 * Makes the lines a bulleted list, or, when all of them are list items with
 * a bullet, plain text again. A numbered item takes a bullet instead.
 */
export const toggleList: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const bulleted = (line: Prefix) => /^[-+*]$/.test(line.marker ?? "");
    const unlist = lines.every(bulleted);
    return lines.flatMap((line): ChangeSpec[] => {
      if (unlist) return [{ from: line.at, to: line.at + line.itemLength }];
      if (bulleted(line)) return [];
      if (line.marker === undefined) return [{ from: line.at, insert: "- " }];
      return [{ from: line.at, to: line.at + line.marker.length, insert: "-" }];
    });
  });

type Task = "text" | "item" | "open" | "done";
type Target = Exclude<Task, "text">;

function task(line: Prefix): Task {
  if (line.marker === undefined) return "text";
  if (line.box === undefined) return "item";
  return line.box === " " ? "open" : "done";
}

/** Turns the line into a list item in that state, keeping its marker. */
function makeTask(line: Prefix, state: Target): ChangeSpec[] {
  const now = task(line);
  if (now === state) return [];
  if (state === "item") {
    return now === "text"
      ? [{ from: line.at, insert: "- " }]
      : [{ from: line.boxAt, to: line.at + line.itemLength }];
  }
  const mark = state === "open" ? " " : "x";
  const box = `[${mark}] `;
  if (now === "text") return [{ from: line.at, insert: `- ${box}` }];
  if (now === "item") return [{ from: line.boxAt, insert: box }];
  return [{ from: line.boxAt + 1, to: line.boxAt + 2, insert: mark }];
}

/**
 * Moves the lines to the task state after the first line's: a line or a
 * list item becomes an open task, an open task a done one, and a done task
 * a list item again.
 */
export const cycleTask: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const first = lines[0] ? task(lines[0]) : "text";
    const next: Target =
      first === "open" ? "done" : first === "done" ? "item" : "open";
    return lines.flatMap((line) => makeTask(line, next));
  });

/** The range without the spaces at its ends, the way the user means it. */
function trimmed(state: EditorState, { from, to }: SelectionRange) {
  const text = state.doc.sliceString(from, to);
  const start = from + text.length - text.trimStart().length;
  return { from: start, to: Math.max(start, from + text.trimEnd().length) };
}

/** The bold text, its `**` included, that holds the range, if any. */
function boldAround(
  state: EditorState,
  { from, to }: SelectionRange,
): SyntaxNode | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  for (; node; node = node.parent) {
    if (node.name === "StrongEmphasis" && to <= node.to) return node;
  }
  return undefined;
}

/**
 * Removes the bold around each selected range, or makes it bold. An empty
 * range gets `****` with the cursor inside, which a second tap takes away;
 * typed in, a second tap at the end of the bold text steps out of it.
 */
export const toggleBold: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const edit = state.changeByRange((range) => {
    const bold = boldAround(state, range);
    if (bold && range.empty && range.head === bold.to - 2) {
      return { range: EditorSelection.cursor(bold.to) };
    }
    if (bold) {
      const changes = state.changes([
        { from: bold.from, to: bold.from + 2 },
        { from: bold.to - 2, to: bold.to },
      ]);
      return {
        changes,
        range: EditorSelection.range(
          changes.mapPos(range.anchor),
          changes.mapPos(range.head),
        ),
      };
    }
    const at = range.head;
    if (range.empty && state.doc.sliceString(at - 2, at + 2) === "****") {
      return {
        changes: { from: at - 2, to: at + 2 },
        range: EditorSelection.cursor(at - 2),
      };
    }
    const { from, to } = trimmed(state, range);
    return {
      changes: [
        { from, insert: "**" },
        { from: to, insert: "**" },
      ],
      range: EditorSelection.range(from + 2, to + 2),
    };
  });
  dispatch(
    state.update(edit, {
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("after"),
    }),
  );
  return true;
};

/**
 * Makes each selected range a link's text, with the cursor where its
 * address goes, or, when the range is a web address, the link's address,
 * with the cursor where its text goes.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const edit = state.changeByRange((range) => {
    const { from, to } = trimmed(state, range);
    if (/^https?:\/\/\S+$/.test(state.doc.sliceString(from, to))) {
      return {
        changes: [
          { from, insert: "[](" },
          { from: to, insert: ")" },
        ],
        range: EditorSelection.cursor(from + 1),
      };
    }
    return {
      changes: [
        { from, insert: "[" },
        { from: to, insert: "]()" },
      ],
      // An empty link takes its text first.
      range: EditorSelection.cursor(from === to ? from + 1 : to + 3),
    };
  });
  dispatch(
    state.update(edit, {
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("after"),
    }),
  );
  return true;
};

/** The column `text` ends at from `start`, a tab stopping every four. */
function columns(text: string, start = 0): number {
  let column = start;
  for (const char of text) {
    column = char === "\t" ? column + 4 - (column % 4) : column + 1;
  }
  return column;
}

/**
 * The column where a list item's text starts, which the lines nested under
 * it reach, as CommonMark nests them: one past its marker when nothing, or
 * code (five spaces or more), follows it.
 */
function textColumn(item: Prefix): number {
  const marker = columns(item.indent) + (item.marker?.length ?? 0);
  const gap = columns(item.gap, marker) - marker;
  return item.bare || gap > 4 ? marker + 1 : marker + gap;
}

/** The lines above `line` in its quote, nearest first, blank ones left out. */
function* linesAbove(state: EditorState, line: Prefix): Generator<Prefix> {
  for (let number = line.number - 1; number > 0; number--) {
    const above = prefix(state.doc.line(number));
    if (above.quotes !== line.quotes) return;
    if (!above.blank) yield above;
  }
}

/**
 * The list item right above `line`, past the lines nested deeper: its
 * previous sibling when `sibling`, at its indent, or else its parent,
 * indented less. Any other line there ends the search.
 */
function itemAbove(
  state: EditorState,
  line: Prefix,
  sibling: boolean,
): Prefix | undefined {
  const column = columns(line.indent);
  for (const above of linesAbove(state, line)) {
    const at = columns(above.indent);
    if (at > column || (!sibling && at === column)) continue;
    return above.marker !== undefined && (at === column) === sibling
      ? above
      : undefined;
  }
  return undefined;
}

/**
 * What indents the line one level: up to the text of the list item above
 * it at its indent, as a nested item needs, or else an indent unit; a tab
 * where the list already indents with tabs, as Obsidian does.
 */
function indentStep(state: EditorState, line: Prefix): string {
  const sibling = itemAbove(state, line, true);
  const [above] = linesAbove(state, line);
  if ([line, sibling, above].some((other) => other?.indent.startsWith("\t")))
    return "\t";
  if (!sibling) return state.facet(indentUnit);
  return " ".repeat(textColumn(sibling) - columns(line.indent));
}

/**
 * How many columns take the line back one level: to the indent of the list
 * item it is nested under, or else an indent unit's worth of spaces, or a
 * tab, from the end of its indent.
 */
function outdentWidth(state: EditorState, line: Prefix): number {
  const column = columns(line.indent);
  const parent = itemAbove(state, line, false);
  if (parent) return column - columns(parent.indent);
  const spaces = line.indent.length - line.indent.replace(/ +$/, "").length;
  if (spaces > 0) return Math.min(spaces, state.facet(indentUnit).length);
  return column - columns(line.indent.replace(/\t$/, ""));
}

/**
 * Indents the lines one level, after any quote markers: the first line
 * nests under the list item above it, and the others move as far, keeping
 * their nesting.
 */
export const indentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const step = lines[0] ? indentStep(state, lines[0]) : "";
    return lines.map((line) => ({ from: line.at, insert: step }));
  });

/**
 * Takes the lines back one level, after any quote markers: the first line
 * to the indent of the list item it is nested under, and the others as
 * far, as far as their indent goes.
 */
export const outdentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const width = lines[0] ? outdentWidth(state, lines[0]) : 0;
    return lines.map(({ at, indent }) => {
      let kept = indent;
      while (kept !== "" && columns(indent) - columns(kept) < width) {
        kept = kept.slice(0, -1);
      }
      return { from: at - (indent.length - kept.length), to: at };
    });
  });
