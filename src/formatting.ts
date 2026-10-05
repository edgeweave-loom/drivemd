import { isolateHistory } from "@codemirror/commands";
import type {
  ChangeSpec,
  EditorState,
  Line,
  StateCommand,
  Transaction,
} from "@codemirror/state";

/*
 * Markdown formatting, as the keyboard toolbar offers it on phones. Each
 * command is one edit that undo takes back alone, and changes only the
 * Markdown it adds or removes: no line break, and no other byte.
 */

// What comes before a line's own Markdown: quote markers and indentation.
const LEAD = /^(?:[ \t]*>[ \t]?)*[ \t]*/;
// An ATX heading's hashes and the spaces after them.
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;
// A list item's marker and the spaces after it, then its task box if any.
const ITEM = /^([-+*]|\d{1,9}[.)])([ \t]+)(?:\[([ xX])\](?:[ \t]+|$))?/;

/** A line's Markdown at its start, after any quote markers and indent. */
function prefix(line: Line) {
  const rest = line.text.replace(LEAD, "");
  const lead = line.text.length - rest.length;
  const heading = HEADING.exec(rest);
  const item = ITEM.exec(rest);
  return {
    /** Where the line's own Markdown starts. */
    at: line.from + lead,
    blank: rest === "",
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
