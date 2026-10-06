import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, indentUnit, syntaxTree } from "@codemirror/language";
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
    /** Where the line's own Markdown starts. */
    at: line.from + lead,
    blank: rest === "",
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

/** The column `text` ends at from `start`, a tab stopping every four. */
function columns(text: string, start = 0): number {
  let column = start;
  for (const char of text) {
    column = char === "\t" ? column + 4 - (column % 4) : column + 1;
  }
  return column;
}

/** The column of `pos` in its line, from the line's start, `>` included. */
function columnAt(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return columns(line.text.slice(0, pos - line.from));
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
  const marker = columns(line.text.slice(0, end));
  const after = line.text.slice(end);
  const gap = INDENT.exec(after)?.[0] ?? "";
  const text = columns(gap, marker);
  return gap === after || text - marker > 4 ? marker + 1 : text;
}

/**
 * Whether the lists of these items indent with tabs, as Obsidian's do by
 * default: an item's own line, the item that holds the list, or the first
 * item of a list nested in one.
 */
function tabbed(state: EditorState, items: SyntaxNode[]): boolean {
  const starts: number[] = [];
  for (const list of items.map((item) => item.parent)) {
    if (list?.parent?.name === "ListItem") starts.push(list.parent.from);
    for (let item = list?.firstChild; item; item = item.nextSibling) {
      starts.push(item.from);
      for (let inner = item.firstChild; inner; inner = inner.nextSibling) {
        if (LISTS.has(inner.name) && inner.firstChild)
          starts.push(inner.firstChild.from);
      }
    }
  }
  return starts.some((at) =>
    prefix(state.doc.lineAt(at)).indent.includes("\t"),
  );
}

/**
 * The length of the item's number when nesting it makes it the first item
 * of a new numbered list, which only a 1 lets break into the text of the
 * item above (CommonMark): none when it joins the numbered list, with its
 * delimiter, that the item above already ends with.
 */
function restarted(
  state: EditorState,
  item: SyntaxNode,
  above: SyntaxNode,
): number {
  const mark = item.firstChild;
  const number =
    mark && /^(\d+)([.)])$/.exec(state.sliceDoc(mark.from, mark.to));
  if (!number?.[1] || number[1] === "1") return 0;
  const nested = above.lastChild;
  const last = nested?.name === "OrderedList" ? nested.lastChild : null;
  const end = last?.firstChild?.to;
  const joins = end !== undefined && state.sliceDoc(end - 1, end) === number[2];
  return joins ? 0 : number[1].length;
}

/**
 * How the line nests one level: under the list item before it, at that
 * item's text, as a nested item needs, or else by an indent unit; with tabs
 * where its list indents with tabs. A numbered item that starts a new list
 * there takes the number 1.
 */
function nesting(state: EditorState, line: Prefix) {
  const found = itemAt(state, line);
  const item = opens(found, line) ? found : null;
  const above = item && itemBefore(item);
  const items = [item, above].filter((node) => node !== null);
  const tabs = line.indent.includes("\t") || tabbed(state, items);
  if (!item || !above) {
    return { step: tabs ? "\t" : state.facet(indentUnit), number: 0 };
  }
  const from = columnAt(state, line.at);
  const to = textColumn(state, above);
  let step = " ".repeat(to - from);
  if (tabs) {
    step = "";
    for (let at = from; at < to; at += 4 - (at % 4)) step += "\t";
  }
  return { step, number: restarted(state, item, above) };
}

/**
 * The indent the line goes back to: the one of the list item that holds
 * it, as written, or else an indent unit's worth of spaces, or a tab, less.
 */
function outdented(state: EditorState, line: Prefix): string {
  const found = itemAt(state, line);
  const holder = opens(found, line) ? enclosing(found.parent) : found;
  const start = columnAt(state, line.at - line.indent.length);
  const indent = holder && prefix(state.doc.lineAt(holder.from)).indent;
  // Text running on at a smaller indent than its item's is not nested.
  if (indent !== null && columns(indent, start) < columns(line.indent, start))
    return indent;
  // Counted from the end: a regex would try each start in turn.
  let spaces = 0;
  while (line.indent[line.indent.length - 1 - spaces] === " ") spaces += 1;
  const unit = state.facet(indentUnit).length;
  return spaces > 0
    ? line.indent.slice(0, -Math.min(spaces, unit))
    : line.indent.replace(/\t$/, "");
}

/**
 * The line's indent `width` columns back, never past its start, in one
 * pass: a tab cut part way leaves the spaces before the column reached.
 */
function shifted(state: EditorState, line: Prefix, width: number): string {
  const start = columnAt(state, line.at - line.indent.length);
  const target = columns(line.indent, start) - width;
  let column = start;
  let kept = 0;
  for (const char of line.indent) {
    const next = char === "\t" ? column + 4 - (column % 4) : column + 1;
    if (next > target) break;
    column = next;
    kept += 1;
  }
  return line.indent.slice(0, kept) + " ".repeat(Math.max(0, target - column));
}

/** Gives the line `indent` in place of its own. */
function reindent(line: Prefix, indent: string): ChangeSpec {
  return { from: line.at - line.indent.length, to: line.at, insert: indent };
}

/**
 * Indents the lines one level, after any quote markers: the first line
 * nests under the list item before it, and the others move as far, keeping
 * their nesting.
 */
export const indentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const [first] = lines;
    if (!first) return [];
    const { step, number } = nesting(state, first);
    return [
      ...lines.map((line) => ({ from: line.at, insert: step })),
      ...(number > 0
        ? [{ from: first.at, to: first.at + number, insert: "1" }]
        : []),
    ];
  });

/**
 * Takes the lines back one level, after any quote markers: the first line
 * to the indent of the list item that holds it, and the others as many
 * columns back, as far as their indent goes.
 */
export const outdentLines: StateCommand = ({ state, dispatch }) =>
  formatLines(state, dispatch, (lines) => {
    const [first] = lines;
    if (!first) return [];
    const indent = outdented(state, first);
    const start = columnAt(state, first.at - first.indent.length);
    const width = columns(first.indent, start) - columns(indent, start);
    return lines.map((line) =>
      reindent(line, line === first ? indent : shifted(state, line, width)),
    );
  });
