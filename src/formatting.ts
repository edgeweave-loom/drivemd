import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, indentUnit, syntaxTree } from "@codemirror/language";
import {
  countColumn,
  EditorSelection,
  findColumn,
  type ChangeSpec,
  type EditorState,
  type Line,
  type SelectionRange,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  CALLOUT_TYPES,
  calloutMarker,
  titled,
  type CalloutType,
} from "./callouts.ts";
import type { IconName } from "./icons.ts";

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
  const item = ITEM.exec(rest);
  // A list item holds a heading after its marker, as GitHub and Obsidian
  // read it, but not a task, whose box GFM reads before a paragraph alone.
  const after = item?.[3] === undefined ? (item?.[0].length ?? 0) : null;
  const heading = after === null ? null : HEADING.exec(rest.slice(after));
  return {
    /** Where the line's own Markdown starts. */
    at: line.from + lead,
    blank: rest === "",
    /** The line's quote markers, as written. */
    quotes: line.text.slice(0, line.text.length - quoted.length),
    /** The line's indent, after any quote markers. */
    indent: quoted.slice(0, quoted.length - rest.length),
    /** Where a heading's hashes start, or would, after a list's marker. */
    headingAt: line.from + lead + (after ?? 0),
    heading: heading?.[1]?.length ?? 0,
    headingLength: heading?.[0].length ?? 0,
    marker: item?.[1],
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
function selectedLines(state: EditorState, inner = false): Prefix[] {
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
  if (filled.length === 0) return lines;
  // Or, when `inner`, those between the first and the last filled ones too.
  const filledAt = (line: Prefix) => !line.blank;
  return inner
    ? lines.slice(lines.findIndex(filledAt), lines.findLastIndex(filledAt) + 1)
    : filled;
}

/** Applies the changes `format` makes to the selected lines. */
function formatLines(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  format: (lines: Prefix[]) => ChangeSpec[],
  lines = selectedLines(state),
): boolean {
  if (state.readOnly) return false;
  const changes = state.changes(format(lines));
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
 * Applies the changes `format` makes to the selected lines that `takes`,
 * out of code and the front matter, whose lines show as written. It is off
 * where none is left, and where the parse has not reached the last.
 */
function formatText(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  format: (lines: Prefix[]) => ChangeSpec[],
  takes: (line: Prefix) => boolean = () => true,
): boolean {
  const lines = selectedLines(state);
  const last = lines.at(-1);
  const tree =
    last && ensureSyntaxTree(state, state.doc.lineAt(last.at).to, 100);
  if (!tree) return false;
  const text = lines.filter(
    (line) =>
      takes(line) && !blockAt(tree, state.doc.lineAt(line.at), AS_WRITTEN),
  );
  return text.length > 0 && formatLines(state, dispatch, format, text);
}

// A task holds no heading, nor a heading a task's box: GFM reads the box
// before a paragraph alone.
const takesHeading = (line: Prefix) => line.box === undefined;
const takesBox = (line: Prefix) => line.heading === 0;

/**
 * Makes the line a heading of that level, or text at 0, a list item's
 * heading after its marker.
 */
function makeHeading(line: Prefix, level: number): ChangeSpec[] {
  const at = line.headingAt;
  const hashes = at + line.heading;
  if (line.heading === level) return [];
  if (line.heading === 0) {
    return [{ from: at, insert: `${"#".repeat(level)} ` }];
  }
  if (level === 0) return [{ from: at, to: at + line.headingLength }];
  return level > line.heading
    ? [{ from: hashes, insert: "#".repeat(level - line.heading) }]
    : [{ from: at + level, to: hashes }];
}

/**
 * Turns the lines into text, at 0, or headings of each level from 1 to 6,
 * by index, leaving tasks alone.
 */
export const HEADINGS: readonly StateCommand[] = [0, 1, 2, 3, 4, 5, 6].map(
  (level) =>
    ({ state, dispatch }) =>
      formatText(
        state,
        dispatch,
        (lines) => lines.flatMap((line) => makeHeading(line, level)),
        takesHeading,
      ),
);

/**
 * Turns the lines into headings of that level, or into text when every one
 * is a heading of that level already, as the lists are taken off.
 */
function toggleHeading(level: number): StateCommand {
  return ({ state, dispatch }) =>
    formatText(
      state,
      dispatch,
      (lines) => {
        const to = lines.every((line) => line.heading === level) ? 0 : level;
        return lines.flatMap((line) => makeHeading(line, to));
      },
      takesHeading,
    );
}

/** Heading 1 to 3 as the keyboard toolbar's Heading menu toggles them. */
export const TOGGLE_HEADINGS = [
  toggleHeading(1),
  toggleHeading(2),
  toggleHeading(3),
] as const;

type List = "bullet" | "number";

function list(line: Prefix): List | undefined {
  if (line.marker === undefined) return undefined;
  return /^\d/.test(line.marker) ? "number" : "bullet";
}

/**
 * The other lines of the list item that starts the line that its text's
 * column holds, past a lazy line, which needs no indent to stay in it.
 */
function itemLines(state: EditorState, line: Prefix): Line[] {
  const tree = ensureSyntaxTree(state, line.at + 1, 100) ?? syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(line.at, 1);
  while (node && !(node.name === "ListItem" && node.from === line.at)) {
    node = node.parent;
  }
  if (!node) return [];
  const first = state.doc.lineAt(line.at);
  const text = countColumn(first.text.slice(0, line.boxAt - first.from), TAB);
  const lines: Line[] = [];
  const last = state.doc.lineAt(node.to).number;
  for (let number = first.number + 1; number <= last; number++) {
    const next = state.doc.line(number);
    const held = prefix(next);
    if (!held.blank && column(held) >= text) lines.push(next);
  }
  return lines;
}

/**
 * Makes the lines list items of that kind, or text when `to` is undefined.
 * Numbers count from 1 at each level, keeping a numbered item's `.` or `)`.
 * A marker that widens moves the item's other lines as far, so that what it
 * holds stays in it.
 */
function makeList(
  state: EditorState,
  lines: Prefix[],
  to: List | undefined,
): ChangeSpec[] {
  const counts = new Map<number, number>();
  // Spaces that each line's text moves by, from the markers above it.
  const moves = new Map<number, number>();
  const marked = lines.map((line) => {
    if (to === undefined) {
      return line.marker === undefined
        ? undefined
        : { line, to: line.at + line.itemLength, insert: "" };
    }
    let marker = "-";
    if (to === "number") {
      const level = column(line);
      for (const deeper of counts.keys()) {
        if (deeper > level) counts.delete(deeper);
      }
      const count = (counts.get(level) ?? 0) + 1;
      counts.set(level, count);
      marker = `${String(count)}${line.marker?.match(/[.)]$/)?.[0] ?? "."}`;
    } else if (list(line) === "bullet") return undefined;
    if (line.marker === undefined) {
      return { line, to: line.at, insert: `${marker} ` };
    }
    const wider = marker.length - line.marker.length;
    if (wider > 0) {
      for (const inner of itemLines(state, line)) {
        moves.set(inner.from, (moves.get(inner.from) ?? 0) + wider);
      }
    }
    return { line, to: line.at + line.marker.length, insert: marker };
  });
  const changes: ChangeSpec[] = [];
  const edited = new Set<number>();
  for (const change of marked) {
    if (!change) continue;
    const from = change.line.at;
    const move = " ".repeat(moves.get(state.doc.lineAt(from).from) ?? 0);
    edited.add(state.doc.lineAt(from).from);
    if (move + change.insert !== state.doc.sliceString(from, change.to)) {
      changes.push({ from, to: change.to, insert: move + change.insert });
    }
  }
  for (const [from, spaces] of moves) {
    if (edited.has(from)) continue;
    changes.push({
      from: prefix(state.doc.lineAt(from)).at,
      insert: " ".repeat(spaces),
    });
  }
  return changes;
}

/**
 * Makes the lines a bulleted list, or, when all of them are list items with
 * a bullet, plain text again. A numbered item takes a bullet instead.
 */
export const toggleList: StateCommand = ({ state, dispatch }) =>
  formatText(state, dispatch, (lines) =>
    makeList(
      state,
      lines,
      lines.every((line) => list(line) === "bullet") ? undefined : "bullet",
    ),
  );

/**
 * Makes the lines a numbered list, `1.`, `2.`, `3.`, or, when all of them
 * are numbered list items, plain text again.
 */
export const toggleNumbered: StateCommand = ({ state, dispatch }) =>
  formatText(state, dispatch, (lines) =>
    makeList(
      state,
      lines,
      lines.every((line) => list(line) === "number") ? undefined : "number",
    ),
  );

/**
 * Makes the lines a quote, `> `, blank lines between them included, or,
 * when all of them are quoted, takes their outer quote marker away. A line
 * in no quote takes its whole block with it, as `quoteBlocks` writes it.
 */
export const toggleQuote: StateCommand = ({ state, dispatch }) =>
  formatLines(
    state,
    dispatch,
    (lines) =>
      lines.every((line) => line.quotes.includes(">"))
        ? lines.map((line) => {
            const start = line.at - line.indent.length - line.quotes.length;
            return markAt(state, start + line.quotes.indexOf(">"));
          })
        : quoteBlocks(
            state,
            lines.map((line) => state.doc.lineAt(line.at)),
          ),
    selectedLines(state, true),
  );

/**
 * Quotes the lines that are not, as Quote does, never taking a quote away:
 * where all of them are quoted, it writes nothing.
 */
export const quoteLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = selectedLines(state, true);
  const changes = quoteBlocks(
    state,
    lines.map((line) => state.doc.lineAt(line.at)),
  );
  if (changes.length === 0) return true;
  return formatLines(state, dispatch, () => changes, lines);
};

interface Range {
  from: number;
  to: number;
}

/** A quote's mark, `>`, at `at`, with the space or tab after it. */
function markAt(state: EditorState, at: number): Range {
  const space = /[ \t]/.test(state.sliceDoc(at + 1, at + 2));
  return { from: at, to: at + (space ? 2 : 1) };
}

/** Quotes a line, as Quote does, if it is not quoted yet. */
function quoteLine(state: EditorState, line: Prefix): ChangeSpec[] {
  if (line.quotes !== "") return [];
  const from = state.doc.lineAt(line.at).from;
  return [{ from, insert: line.blank ? ">" : "> " }];
}

const blank = (line: Line) => line.text.trim() === "";

/**
 * Quotes the lines as Quote does: a line in a quote alone, if it is not
 * quoted yet, as a lazy one, and any other line with the whole block it is
 * in, so that no paragraph, table, list or setext heading splits. Each run
 * of lines quoted is a blank line apart from the text before and after it
 * that is not among `lines`, so that it joins no block next to it; those
 * among them, a quote, it joins. `opening`, where given, is the first line's
 * mark in place of `> `.
 */
function quoteBlocks(
  state: EditorState,
  lines: readonly Line[],
  opening?: string,
): ChangeSpec[] {
  const { doc, lineBreak } = state;
  const last = lines.at(-1);
  if (!last) return [];
  let tree = ensureSyntaxTree(state, last.to, 100) ?? syntaxTree(state);
  ({ tree } = readBlock(state, tree, last, topBlock));
  const picked = new Set(lines.map((line) => line.number));
  const marked = new Set<number>();
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const block = topBlock(tree, line);
    if (block?.name === "Blockquote") {
      changes.push(...quoteLine(state, prefix(line)));
      continue;
    }
    const from = block ? doc.lineAt(block.from).number : line.number;
    const to = block ? doc.lineAt(block.to).number : line.number;
    for (let number = from; number <= to; number++) marked.add(number);
  }
  // A line with text, neither selected nor quoted, that a run would join.
  const apart = (number: number) =>
    number >= 1 &&
    number <= doc.lines &&
    !picked.has(number) &&
    !marked.has(number) &&
    !blank(doc.line(number));
  const numbers = [...marked].sort((one, other) => one - other);
  for (const number of numbers) {
    const line = doc.line(number);
    if (apart(number - 1)) changes.push({ from: line.from, insert: lineBreak });
    const mark = blank(line) ? ">" : "> ";
    const first = number === numbers[0] && opening !== undefined;
    changes.push({ from: line.from, insert: first ? opening : mark });
    if (apart(number + 1)) {
      changes.push({ from: doc.line(number + 1).from, insert: lineBreak });
    }
  }
  return changes;
}

/**
 * A quote's first block, past its marks, if it has one, and the callout's
 * marker that opens it, if the quote is a callout: a paragraph that starts
 * with `[!type]`.
 */
export function quoteOpening(state: EditorState, quote: SyntaxNode) {
  let first = quote.firstChild;
  while (first?.name === "QuoteMark") first = first.nextSibling;
  const marker =
    first?.name === "Paragraph"
      ? calloutMarker(
          state.sliceDoc(first.from, state.doc.lineAt(first.from).to),
        )
      : null;
  return { first, marker };
}

/** The first selected line with text, or else the first one. */
function firstSelected(state: EditorState): Line {
  const { ranges } = state.selection;
  for (const range of ranges) {
    for (let at = range.from; at <= range.to;) {
      const line = state.doc.lineAt(at);
      if (!BLANK.test(line.text) && (range.empty || range.to > line.from)) {
        return line;
      }
      at = line.to + 1;
    }
  }
  return state.doc.lineAt(ranges[0]?.from ?? 0);
}

/**
 * The block of the note's own that a line is in, out of any list or quote,
 * if any.
 */
function topBlock(tree: Tree, line: Line): SyntaxNode | null {
  let node = tree.resolveInner(line.to, -1);
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  return node.name === "Document" ? null : node;
}

// What `[!type]` writes after it, on a line of its own above a block that
// is not a paragraph: a line break and the marks of the block's line, as
// those of a line that continues it.
function titleAbove(state: EditorState, block: SyntaxNode): string {
  const line = state.doc.lineAt(block.from);
  const marks = state.sliceDoc(line.from, block.from).replace(/[^>\s]/g, " ");
  return `${state.lineBreak}${marks}`;
}

/** The marker of a callout of `type` in a quote that is not yet one. */
function markQuote(
  state: EditorState,
  quote: SyntaxNode,
  type: CalloutType,
): ChangeSpec[] {
  const { first, marker } = quoteOpening(state, quote);
  if (marker) {
    if (marker.type === type) return [];
    // After its `[!`.
    const from = (first?.from ?? 0) + 2;
    return [{ from, to: from + marker.name.length, insert: type }];
  }
  if (!first) {
    // A quote of nothing but its marks: its text would follow them.
    const { to } = state.doc.lineAt(quote.from);
    const space = /[ \t]/.test(state.sliceDoc(to - 1, to)) ? "" : " ";
    return [{ from: to, insert: `${space}[!${type}] ` }];
  }
  const title = first.name === "Paragraph" ? " " : titleAbove(state, first);
  return [{ from: first.from, insert: `[!${type}]${title}` }];
}

/**
 * Makes the selected lines a callout of `type`, in lower case, as one edit.
 * In a quote, the innermost around the first line, only that quote
 * changes: a callout's type, the name in its `[!type]` alone, and nothing
 * where it already shows as `type`, written as an alias or unknown; or a
 * quote's first paragraph, which `[!type] ` makes the title. Lines not
 * quoted, up to one that is, are quoted as Quote does, a first line of a
 * paragraph's text becoming the title. Another block keeps its line, under
 * a title's of its own. It is off in code, in the front matter, and where
 * the parse has not reached.
 */
export function makeCallout(type: CalloutType): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const first = firstSelected(state);
    const tree = ensureSyntaxTree(state, first.to, 100);
    if (!tree || blockAt(tree, first, AS_WRITTEN)) return false;
    const quote = blockAt(tree, first, ["Blockquote"]);
    let changes: ChangeSpec[];
    if (quote) {
      changes = markQuote(state, quote, type);
    } else {
      // The range of the first line alone: another cursor's is far away.
      const range =
        state.selection.ranges.find(
          (one) => lastLine(state, one).number >= first.number,
        ) ?? state.selection.main;
      const last = lastLine(state, range);
      const read = ensureSyntaxTree(state, last.to, 100) ?? tree;
      const taken: Line[] = [];
      for (let at = first.number; at <= last.number; at++) {
        const line = state.doc.line(at);
        if (topBlock(read, line)?.name === "Blockquote") break;
        taken.push(line);
      }
      // Blank lines before a quote would join it to the callout.
      const end = taken.findLastIndex((line) => !blank(line));
      taken.splice(Math.max(end, 0) + 1);
      const block = topBlock(tree, first);
      const title =
        !block || block.name === "Paragraph" ? " " : `${state.lineBreak}> `;
      changes = quoteBlocks(state, taken, `> [!${type}]${title}`);
    }
    if (changes.length === 0) return true;
    return formatLines(state, dispatch, () => changes);
  };
}

/**
 * The quote's own mark on each of its lines, by line number. A line's marks
 * run from the outermost quote in, whichever node of the tree holds them,
 * a paragraph's later lines holding those of the quotes around it too: the
 * quote's own is the one at its depth, which a lazy line lacks.
 */
function quoteMarks(
  state: EditorState,
  tree: Tree,
  quote: SyntaxNode,
): Map<number, Range> {
  let depth = 0;
  for (let node: SyntaxNode | null = quote; node; node = node.parent) {
    if (node.name === "Blockquote") depth++;
  }
  const marks = new Map<number, Range>();
  const last = state.doc.lineAt(quote.to).number;
  for (let at = state.doc.lineAt(quote.from).number; at <= last; at++) {
    const line = state.doc.line(at);
    const found: number[] = [];
    tree.iterate({
      from: line.from,
      to: line.to,
      enter: (node) => {
        if (node.name === "QuoteMark" && node.from >= line.from) {
          found.push(node.from);
        }
      },
    });
    const own = found.sort((one, other) => one - other)[depth - 1];
    if (own !== undefined) marks.set(at, markAt(state, own));
  }
  return marks;
}

/**
 * Where a callout's `[!type]` is, with its fold sign and the spaces after
 * it, so that its title opens the quote once it goes; or, where it has no
 * title and the callout goes on, up to where the quote's text starts on
 * the next line, which then opens it, what comes before it staying.
 */
function calloutMarkerAt(
  state: EditorState,
  quote: SyntaxNode,
  opening: SyntaxNode,
  length: number,
  marks: Map<number, Range>,
): Range {
  const line = state.doc.lineAt(opening.from);
  if (opening.from + length >= line.to && line.to < quote.to) {
    const next = state.doc.line(line.number + 1);
    return { from: opening.from, to: marks.get(next.number)?.to ?? next.from };
  }
  return { from: opening.from, to: opening.from + length };
}

/**
 * Sets the format of the quote around the first selected line, the
 * innermost, to one of those Quote's menus list, a plain quote or a
 * callout's type, as one edit. The format it is in already turns it back
 * into text, whole; another changes it: lines not quoted become a quote as
 * Quote makes it, a callout a plain one as it loses its `[!type]` and fold
 * sign, and a type is `makeCallout`'s. Off in code, in the front matter,
 * and where the parse has not reached.
 */
export function quoteAs(target: CalloutType | "quote"): StateCommand {
  return (view) => {
    const { state, dispatch } = view;
    if (state.readOnly) return false;
    const first = firstSelected(state);
    const tree = ensureSyntaxTree(state, first.to, 100);
    if (!tree || blockAt(tree, first, AS_WRITTEN)) return false;
    const quote = blockAt(tree, first, ["Blockquote"]);
    if (!quote) {
      return target === "quote" ? toggleQuote(view) : makeCallout(target)(view);
    }
    const { first: opening, marker } = quoteOpening(state, quote);
    const now = marker?.type ?? "quote";
    if (target !== now && target !== "quote") return makeCallout(target)(view);
    const marks = quoteMarks(state, tree, quote);
    // A callout loses its `[!type]` either way. Each change maps through
    // those before it, so a mark that went with it is gone.
    const changes: Range[] =
      marker && opening
        ? [calloutMarkerAt(state, quote, opening, marker.length, marks)]
        : [];
    if (target === now) changes.push(...marks.values());
    return formatLines(state, dispatch, () => changes);
  };
}

/** A format of Quote's menus: a plain quote, or a callout's type. */
export interface QuoteFormat {
  name: string;
  /** Its icon, a callout's type's drawn in its place. */
  icon: IconName;
  /** The callout's type, which a plain quote lacks. */
  callout?: CalloutType;
  command: StateCommand;
  /** Whether the quote around the cursor is in it. */
  on: (formats: Formats) => boolean;
}

/**
 * Quote's formats in a vault's note, as both toolbars list them: each a
 * way to go and, where the quote is in it, back to text.
 */
export const QUOTE_FORMATS: readonly QuoteFormat[] = [
  {
    name: "Plain quote",
    icon: "blockquote",
    command: quoteAs("quote"),
    on: ({ quoted, callout }) => quoted && callout === null,
  },
  ...CALLOUT_TYPES.map((type): QuoteFormat => ({
    name: titled(type),
    icon: "blockquote",
    callout: type,
    command: quoteAs(type),
    on: ({ callout }) => callout === type,
  })),
];

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
 * a list item again. Headings stay as they are.
 */
export const cycleTask: StateCommand = ({ state, dispatch }) =>
  formatText(
    state,
    dispatch,
    (lines) => {
      const first = lines[0] ? task(lines[0]) : "text";
      const next: Target =
        first === "open" ? "done" : first === "done" ? "item" : "open";
      return lines.flatMap((line) => makeTask(line, next));
    },
    takesBox,
  );

/** The range without the spaces at its ends, the way the user means it. */
function trimmed(state: EditorState, { from, to }: SelectionRange) {
  const text = state.doc.sliceString(from, to);
  const start = from + text.length - text.trimStart().length;
  return { from: start, to: Math.max(start, from + text.trimEnd().length) };
}

/** The inline node of that name, its marks included, holding the range. */
function inlineAround(
  state: EditorState,
  { from, to }: SelectionRange,
  name: string,
): SyntaxNode | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  for (; node; node = node.parent) {
    if (node.name === name && to <= node.to) return node;
  }
  return undefined;
}

/**
 * Takes away the formatting of that node around each selected range, its
 * marks as written, or adds it, the marks from `marks` around the range's
 * text. An empty range gets both marks with the cursor between them, which
 * a second tap takes away; typed in, a second tap before the closing mark
 * steps out of it.
 */
function toggleInline(
  name: string,
  marks: (text: string) => readonly [string, string],
): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const edit = state.changeByRange((range) => {
      const node = inlineAround(state, range, name);
      const open = node?.firstChild;
      const close = node?.lastChild;
      if (open && close && open !== close) {
        if (range.empty && range.head === close.from) {
          return { range: EditorSelection.cursor(close.to) };
        }
        // Inline code's padding, a space inside each backtick, goes too.
        const inner = state.doc.sliceString(open.to, close.from);
        const pad = name === "InlineCode" && /^ .*\S.* $/s.test(inner) ? 1 : 0;
        const changes = state.changes([
          { from: open.from, to: open.to + pad },
          { from: close.from - pad, to: close.to },
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
      const [before, after] = marks("");
      if (
        range.empty &&
        state.doc.sliceString(at - before.length, at + after.length) ===
          before + after
      ) {
        return {
          changes: { from: at - before.length, to: at + after.length },
          range: EditorSelection.cursor(at - before.length),
        };
      }
      const { from, to } = trimmed(state, range);
      const [start, end] = marks(state.doc.sliceString(from, to));
      return {
        changes: [
          { from, insert: start },
          { from: to, insert: end },
        ],
        range: EditorSelection.range(from + start.length, to + start.length),
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
}

/** Makes each selected range bold, `**`, or takes the bold around it away. */
export const toggleBold = toggleInline("StrongEmphasis", () => ["**", "**"]);

/**
 * Makes each selected range italic, `*`, or takes the italic around it
 * away, written with `*` or `_`.
 */
export const toggleItalic = toggleInline("Emphasis", () => ["*", "*"]);

/** Strikes each selected range through, `~~`, or takes the strike away. */
export const toggleStrikethrough = toggleInline("Strikethrough", () => [
  "~~",
  "~~",
]);

/**
 * Makes each selected range inline code, or takes the code around it
 * away: one backtick more than the longest run in the text, and a space
 * inside each when the text starts or ends with one, as CommonMark reads
 * them.
 */
export const toggleCode = toggleInline("InlineCode", (text) => {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? " " : "";
  return [fence + pad, pad + fence];
});

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

// Tab stops every four columns, as CommonMark sets them.
const TAB = 4;

/** The column where the line's own Markdown starts, `>` included. */
function column(line: Prefix): number {
  return countColumn(line.quotes + line.indent, TAB);
}

/**
 * An indent of tabs alone after `quotes`, up to the first tab stop at or
 * past column `target`, which lies past them.
 */
function tabsTo(quotes: string, target: number): string {
  const stop = countColumn(`${quotes}\t`, TAB);
  return "\t".repeat(1 + Math.max(0, Math.ceil((target - stop) / TAB)));
}

const LISTS = new Set(["BulletList", "OrderedList"]);

/**
 * The innermost list item that holds the start of the line's text, as the
 * parser reads the note, which it may not have reached in a long one.
 */
function itemAt(state: EditorState, line: Prefix): SyntaxNode | null {
  const reach = state.doc.lineAt(line.at).to;
  const tree = ensureSyntaxTree(state, reach, 100) ?? syntaxTree(state);
  return enclosing(tree.resolveInner(line.at, 1));
}

/** The node itself, or its nearest ancestor, that is a list item. */
function enclosing(node: SyntaxNode | null): SyntaxNode | null {
  for (; node; node = node.parent) if (node.name === "ListItem") return node;
  return null;
}

/**
 * Whether the item's marker opens the line. A nested item starts at its
 * parent's text, before the indent that its marker may have.
 */
function opens(item: SyntaxNode | null, line: Prefix): item is SyntaxNode {
  return item?.firstChild?.from === line.at;
}

/**
 * The list item before `item` at its level: the one before it in its list,
 * or the last of a list, of another kind, right before its own.
 */
function itemBefore(item: SyntaxNode): SyntaxNode | null {
  let before = item.prevSibling;
  // Lines in a quote put a quote mark between items.
  while (before?.name === "QuoteMark") before = before.prevSibling;
  if (before) return before;
  before = item.parent?.prevSibling ?? null;
  while (before?.name === "QuoteMark") before = before.prevSibling;
  return before && LISTS.has(before.name) ? before.lastChild : null;
}

/**
 * The column where a list item's text starts, which the lines nested under
 * it reach, as CommonMark nests them: one past its marker when nothing, or
 * code (five columns or more), follows it.
 */
function textColumn(state: EditorState, item: SyntaxNode): number {
  const line = state.doc.lineAt(item.from);
  const end = (item.firstChild?.to ?? item.from) - line.from;
  const gap = INDENT.exec(line.text.slice(end))?.[0].length ?? 0;
  const marker = countColumn(line.text, TAB, end);
  const text = countColumn(line.text, TAB, end + gap);
  return end + gap === line.length || text - marker > 4 ? marker + 1 : text;
}

/** The indent of the line that the item's marker opens. */
function indentOf(state: EditorState, item: SyntaxNode): string {
  return prefix(state.doc.lineAt(item.from)).indent;
}

/** The first item of the list nested in `item`, if any. */
function nestedItem(item: SyntaxNode | null): SyntaxNode | null {
  for (let child = item?.firstChild; child; child = child.nextSibling) {
    if (LISTS.has(child.name)) return child.getChild("ListItem");
  }
  return null;
}

/**
 * Whether the item's list indents with tabs, as Obsidian's do by default:
 * the item before it, the item that holds the list, or the first item
 * nested in the item or the one before it.
 */
function tabbed(
  state: EditorState,
  item: SyntaxNode,
  above: SyntaxNode | null,
): boolean {
  const near = [
    above,
    enclosing(item.parent),
    nestedItem(item),
    nestedItem(above),
  ];
  return near.some((node) => node && indentOf(state, node).includes("\t"));
}

const CONTAINERS = new Set([...LISTS, "ListItem", "Blockquote"]);

/** The last block in `node`, past the quote marks of its lines. */
function lastBlock(node: SyntaxNode): SyntaxNode | null {
  let block = node.lastChild;
  while (block?.name === "QuoteMark") block = block.prevSibling;
  return block;
}

/**
 * The length of the item's number when nesting it would make it run on as
 * the text of a paragraph on the line above, in the item before it: only a
 * numbered list from 1 breaks into a paragraph (CommonMark). None when it
 * joins the numbered list, with its delimiter, that the item above ends
 * with, or when Markdown reads its number as 1 already, as `01`.
 */
function restarted(
  state: EditorState,
  line: Prefix,
  item: SyntaxNode,
  above: SyntaxNode,
): number {
  const mark = item.firstChild;
  const number =
    mark && /^(\d+)([.)])$/.exec(state.sliceDoc(mark.from, mark.to));
  if (!number?.[1] || Number(number[1]) === 1) return 0;
  const nested = lastBlock(above);
  const last = nested?.name === "OrderedList" ? lastBlock(nested) : null;
  const end = last?.firstChild?.to;
  if (end !== undefined && state.sliceDoc(end - 1, end) === number[2]) return 0;
  let block: SyntaxNode | null = above;
  while (block && CONTAINERS.has(block.name)) block = lastBlock(block);
  const text = block?.name === "Paragraph" || block?.name === "Task";
  const next = state.doc.lineAt(block?.to ?? 0).number + 1;
  return text && next === state.doc.lineAt(line.at).number
    ? number[1].length
    : 0;
}

/**
 * The indent that nests the line one level: up to the text of the list item
 * before it, as a nested item needs, or else an indent unit further; with
 * tabs where its list indents with tabs. A numbered item that starts a new
 * list there takes the number 1: `number` is the length of the one it had.
 */
function nesting(state: EditorState, line: Prefix) {
  const found = itemAt(state, line);
  const item = opens(found, line) ? found : null;
  const above = item && itemBefore(item);
  const tabs =
    line.indent.includes("\t") || (item !== null && tabbed(state, item, above));
  const from = column(line);
  const to = above ? textColumn(state, above) : from;
  // Already at that text, as the parser may read a line, it goes a unit on.
  if (!item || !above || to <= from) {
    const indent = tabs
      ? tabsTo(line.quotes, from + 1)
      : line.indent + state.facet(indentUnit);
    return { indent, tabs, number: 0 };
  }
  const indent = tabs
    ? tabsTo(line.quotes, to)
    : line.indent + " ".repeat(to - from);
  return { indent, tabs, number: restarted(state, line, item, above) };
}

/**
 * The indent the line goes back to: a list item takes the one, as written,
 * of the item that holds it; any other line, or an item that none holds,
 * gives up an indent unit's worth of spaces, or a tab.
 */
function outdented(state: EditorState, line: Prefix): string {
  const found = itemAt(state, line);
  const holder = opens(found, line) ? enclosing(found.parent) : null;
  if (holder) return indentOf(state, holder);
  // Counted from the end: a regex would try each start in turn.
  let spaces = 0;
  while (line.indent[line.indent.length - 1 - spaces] === " ") spaces += 1;
  const unit = state.facet(indentUnit).length;
  return spaces > 0
    ? line.indent.slice(0, -Math.min(spaces, unit))
    : line.indent.replace(/\t$/, "");
}

/** Gives the line `indent` in place of its own. */
function reindent(line: Prefix, indent: string): ChangeSpec {
  return { from: line.at - line.indent.length, to: line.at, insert: indent };
}

/**
 * Takes up to `width` columns of whitespace from the start of the line's
 * indent, whole characters only: a tab goes when the width reaches its end.
 */
function unindent(line: Prefix, width: number): ChangeSpec {
  const text = line.quotes + line.indent;
  const limit = countColumn(line.quotes, TAB) + width;
  let cut = findColumn(text, limit, TAB);
  if (countColumn(text, TAB, cut) > limit) cut -= 1;
  const from = line.at - line.indent.length;
  return { from, to: from + Math.max(0, cut - line.quotes.length) };
}

/**
 * Indents the lines one level, after any quote markers: the first line
 * nests under the list item before it, and the others take its step before
 * their own indent, which stays as written, so that code keeps its bytes.
 */
export const indentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const [first, ...others] = lines;
    if (!first) return [];
    const { indent, tabs, number } = nesting(state, first);
    const width = countColumn(first.quotes + indent, TAB) - column(first);
    const step = tabs ? "\t".repeat(Math.ceil(width / TAB)) : " ".repeat(width);
    return [
      reindent(first, indent),
      ...others.map((line) => ({
        from: line.at - line.indent.length,
        insert: step,
      })),
      ...(number > 0
        ? [{ from: first.at, to: first.at + number, insert: "1" }]
        : []),
    ];
  });

/**
 * Takes the lines back one level, after any quote markers: the first line
 * with an indent to the indent of the list item that holds it, or an indent
 * unit back, and the others as many columns from the start of their indent,
 * as written; lines without one stay.
 */
export const outdentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const first = lines.find((line) => line.indent !== "");
    if (!first) return [];
    const indent = outdented(state, first);
    const width = column(first) - countColumn(first.quotes + indent, TAB);
    return lines.map((line) =>
      line === first ? reindent(line, indent) : unindent(line, width),
    );
  });

/**
 * The keys of the commands that keep a table's row whole, which a table's
 * cell edited in place takes too: Google Docs' where it has one.
 */
export const INLINE_KEYS: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  // In place of CodeMirror's own, which selects the syntax around.
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  // GitHub's, as Docs has no inline code.
  { key: "Mod-e", run: toggleCode },
  { key: "Mod-k", run: insertLink },
];

// Where no table, heading or list is written: code, whose lines show as
// written, and the front matter's YAML.
const AS_WRITTEN = ["FencedCode", "CodeBlock", "Frontmatter"];

// The blocks that a table never comes between the lines of, as a line of
// one runs on from the line before: a paragraph's, a setext heading's
// underline, a table's rows.
const WHOLE = [
  "Paragraph",
  "SetextHeading1",
  "SetextHeading2",
  "Table",
  "HTMLBlock",
];

/**
 * The innermost node of `names` that holds `line`, if any, from its end:
 * its start may be a quote's mark, or an indented code block's indent.
 */
function blockAt(
  tree: Tree,
  line: Line,
  names: readonly string[],
): SyntaxNode | null {
  for (
    let node: SyntaxNode | null = tree.resolveInner(line.to, -1);
    node;
    node = node.parent
  ) {
    if (names.includes(node.name)) return node;
  }
  return null;
}

/**
 * The block `find` gives for the line, read to its end, which a parse that
 * ran out of time ends at the line it reached, and the tree that holds it.
 */
function readBlock(
  state: EditorState,
  tree: Tree,
  line: Line,
  find: (tree: Tree, line: Line) => SyntaxNode | null,
) {
  const { doc } = state;
  let block = find(tree, line);
  for (let reach = line.to; block && block.to >= reach;) {
    reach = doc.lineAt(Math.min(block.to + 1, doc.length)).to;
    if (reach === block.to) break;
    tree = ensureSyntaxTree(state, reach, 100) ?? tree;
    block = find(tree, line);
  }
  return { tree, block };
}

/**
 * The last line the range holds, the main selection by default, which one
 * ending at a line's start leaves out, as the formatting of lines does.
 */
function lastLine(
  state: EditorState,
  range: SelectionRange = state.selection.main,
): Line {
  const { from, to } = range;
  const line = state.doc.lineAt(to);
  return to > from && to === line.from ? state.doc.lineAt(to - 1) : line;
}

// A line with nothing but quotes' marks, if any.
const BLANK = /^[ \t>]*$/;

// An empty table of two columns: its head, its delimiter row, and a row
// as Tab's.
const TABLE = ["|  |  |", "| --- | --- |", "|  |  |"];

/**
 * Writes an empty table, its cursor in the head's first cell: on a blank
 * line, there, and on a line with text, the last selected, after the
 * paragraph, the heading or the table it is in, a blank line apart from
 * text before and after, so that a paragraph's last line does not become
 * its head nor the next line a row. Its lines take the quotes' marks of the
 * line it comes after, as a row added does. It is off in code and in the
 * front matter.
 */
export const writeTable: StateCommand = ({ state, dispatch }) => {
  const { doc, lineBreak } = state;
  const last = lastLine(state);
  const tree = ensureSyntaxTree(state, last.to, 100) ?? syntaxTree(state);
  if (state.readOnly || blockAt(tree, last, AS_WRITTEN)) return false;
  const { block } = readBlock(state, tree, last, (read, line) =>
    blockAt(read, line, WHOLE),
  );
  const line = block ? doc.lineAt(block.to) : last;
  const marks = QUOTES.exec(line.text)?.[0] ?? "";
  const gap = marks.trimEnd();
  const filled = (number: number) =>
    number >= 1 && number <= doc.lines && !BLANK.test(doc.line(number).text);
  const rows = TABLE.map((row) => marks + row);
  const there = !block && BLANK.test(line.text);
  const before = there ? filled(line.number - 1) : true;
  const after = filled(line.number + 1);
  const lines = [...(before ? [gap] : []), ...rows, ...(after ? [gap] : [])];
  // On a blank line, in its place, or else after the line.
  const from = there ? line.from : line.to;
  const start = there ? "" : lineBreak;
  // The head's first cell, past the blank line before it, if any.
  const head =
    from + start.length + (before ? gap.length + lineBreak.length : 0);
  dispatch(
    state.update({
      changes: { from, to: line.to, insert: start + lines.join(lineBreak) },
      selection: { anchor: head + marks.length + 2 },
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
    }),
  );
  return true;
};

/**
 * The formatting commands' keys: the headings' and the lists' as Google
 * Docs binds them, and the indent's as Obsidian does.
 */
export const FORMATTING_KEYS: readonly KeyBinding[] = [
  ...INLINE_KEYS,
  ...HEADINGS.map((run, level) => ({ key: `Mod-Alt-${String(level)}`, run })),
  { key: "Mod-Shift-7", run: toggleNumbered },
  { key: "Mod-Shift-8", run: toggleList },
  { key: "Mod-Shift-9", run: cycleTask },
  { key: "Mod-]", run: indentLines },
  { key: "Mod-[", run: outdentLines },
];

// The commands of lines that code and the front matter are off for.
const OF_TEXT: readonly StateCommand[] = [
  ...HEADINGS,
  ...TOGGLE_HEADINGS,
  toggleList,
  toggleNumbered,
  cycleTask,
];

/**
 * The formatting the main selection is in: its line's heading level, and
 * the commands whose formatting holds it, which they would take away. In
 * code and the front matter, the line reads as text.
 */
export interface Formats {
  heading: number;
  /**
   * Whether Insert table is off: in code or the front matter, as the parse
   * has read so far.
   */
  tableOff: boolean;
  /** Whether Quote's formats are off, as Insert table, on the first line. */
  calloutOff: boolean;
  /**
   * The type of the callout around the first selected line, the innermost,
   * as it shows, if it is in one.
   */
  callout: CalloutType | null;
  /** Whether the first selected line is in a quote, a callout included. */
  quoted: boolean;
  on: ReadonlySet<StateCommand | Command>;
  /**
   * The commands of lines that write nothing on the cursor's line, as the
   * parse has read so far: all of them in code and the front matter, the
   * headings on a task, and Checkbox on a heading.
   */
  off: ReadonlySet<StateCommand | Command>;
}

export function formatsAt(state: EditorState): Formats {
  const range = state.selection.main;
  const tree = syntaxTree(state);
  const cursor = state.doc.lineAt(range.head);
  const written = blockAt(tree, cursor, AS_WRITTEN) !== null;
  const line = prefix(cursor);
  const on = new Set<StateCommand | Command>();
  const off = new Set<StateCommand | Command>(written ? OF_TEXT : []);
  const inline: [string, StateCommand][] = [
    ["StrongEmphasis", toggleBold],
    ["Emphasis", toggleItalic],
    ["Strikethrough", toggleStrikethrough],
    ["InlineCode", toggleCode],
  ];
  for (const [name, command] of inline) {
    if (inlineAround(state, range, name)) on.add(command);
  }
  if (line.quotes.includes(">")) on.add(toggleQuote);
  const level = written ? 0 : line.heading;
  if (!written) {
    if (list(line) === "bullet") on.add(toggleList);
    if (list(line) === "number") on.add(toggleNumbered);
    if (line.box !== undefined) {
      on.add(cycleTask);
      for (const command of [...HEADINGS, ...TOGGLE_HEADINGS]) off.add(command);
    }
    const heading = TOGGLE_HEADINGS[level - 1];
    if (heading) on.add(heading);
    if (level > 0) off.add(cycleTask);
  }
  const first = firstSelected(state);
  const quote = blockAt(tree, first, ["Blockquote"]);
  return {
    heading: level,
    tableOff: blockAt(tree, lastLine(state), AS_WRITTEN) !== null,
    calloutOff: blockAt(tree, first, AS_WRITTEN) !== null,
    callout: quote ? (quoteOpening(state, quote).marker?.type ?? null) : null,
    quoted: quote !== null,
    on,
    off,
  };
}
