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
    /** Where the line's own Markdown starts. */
    at: line.from + lead,
    blank: rest === "",
    /** The line's quote markers, as written. */
    quotes: line.text.slice(0, line.text.length - quoted.length),
    /** The line's indent, after any quote markers. */
    indent: quoted.slice(0, quoted.length - rest.length),
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
