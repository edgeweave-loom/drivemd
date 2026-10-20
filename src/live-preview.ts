import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";

interface Stretch {
  from: number;
  to: number;
}

const HIDDEN = Decoration.replace({});

/** A bullet list's `-`, `*` or `+`, drawn as the preview draws it. */
class Bullet extends WidgetType {
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

// Each widget is shared, and CodeMirror keeps the drawing of the same one
// where it stays.
const BULLET = Decoration.replace({ widget: new Bullet() });

/** A task's marker, its list's included, drawn as a box that a tap ticks. */
class TaskBox extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.tabIndex = -1;
    return box;
  }
  // The editor takes the box's taps, which tick the task in the text.
  override ignoreEvent(): boolean {
    return false;
  }
}

const OPEN_TASK = Decoration.replace({ widget: new TaskBox(false) });
const DONE_TASK = Decoration.replace({ widget: new TaskBox(true) });

/**
 * Visual's symbols, hidden where the screen shows them, but on the lines
 * the selection touches while the editor has the focus, where the note is
 * being written.
 */
const hiding = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hidden(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = hidden(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * A tap on a task's box ticks the task, as one edit that undo reverts,
 * where the cursor stays: neither the focus nor the selection moves, nor
 * does the box but with the text.
 */
const ticking = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.target instanceof HTMLInputElement)) return false;
    if (!event.target.classList.contains("cm-task")) return false;
    event.preventDefault();
    tick(view, view.posAtDOM(event.target));
    return true;
  },
  click(event) {
    if (!(event.target instanceof HTMLInputElement)) return false;
    if (!event.target.classList.contains("cm-task")) return false;
    event.preventDefault();
    return true;
  },
});

const LOOK = EditorView.theme({
  // As the preview's.
  ".cm-task": {
    width: "18px",
    height: "18px",
    margin: "0",
    verticalAlign: "-3px",
    accentColor: "var(--primary)",
  },
});

/**
 * Visual: the note as it reads, its Markdown hidden off the lines being
 * written, a hidden symbol being one unit, which the cursor skips and no
 * edit splits.
 */
export const livePreview: Extension = [
  hiding,
  EditorView.atomicRanges.of(
    (view) => view.plugin(hiding)?.decorations ?? Decoration.none,
  ),
  ticking,
  LOOK,
];

/** Ticks or unticks the task whose list item's marker starts at `at`. */
function tick(view: EditorView, at: number): void {
  const marker = syntaxTree(view.state)
    .resolveInner(at, 1)
    .parent?.getChild("Task")
    ?.getChild("TaskMarker");
  if (!marker) return;
  const mark = marker.from + 1;
  view.dispatch({
    changes: {
      from: mark,
      to: mark + 1,
      insert: view.state.sliceDoc(mark, mark + 1) === " " ? "x" : " ",
    },
    userEvent: "input",
    annotations: isolateHistory.of("full"),
  });
}

function hidden(view: EditorView): DecorationSet {
  const { state } = view;
  const writing = view.hasFocus ? linesWritten(state) : [];
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        for (const symbol of symbols(state, node)) {
          if (
            !writing.some(
              (line) => symbol.from <= line.to && symbol.to >= line.from,
            )
          ) {
            ranges.push(symbol);
          }
        }
      },
    });
  }
  // Two visible ranges may both reach a symbol between them.
  return Decoration.set(ranges, true);
}

/** The lines the selection touches, each stretch of them from start to end. */
function linesWritten(state: EditorState): Stretch[] {
  return state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(range.from).from,
    to: state.doc.lineAt(range.to).to,
  }));
}

/**
 * Visual's symbols, hidden or drawn: emphasis' `*` and `_`,
 * strikethrough's `~~`, inline code's backticks, a heading's `#`, a link's
 * brackets and address, and a list item's marker.
 */
function symbols(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  switch (node.name) {
    case "EmphasisMark":
    case "StrikethroughMark":
      return [hide(node)];
    case "CodeMark":
      return node.node.parent?.name === "InlineCode" ? [hide(node)] : [];
    case "HeaderMark":
      return headerMark(state, node).map(hide);
    case "Link":
      return linkSyntax(node).map(hide);
    case "ListMark":
      return listMark(state, node);
    default:
      return [];
  }
}

function hide({ from, to }: Stretch): Range<Decoration> {
  return HIDDEN.range(from, to);
}

/**
 * A list item's marker: a task's, with its own, drawn as its box, a bullet
 * list's as a bullet, while a numbered list's stays as written.
 */
function listMark(
  state: EditorState,
  node: SyntaxNodeRef,
): Range<Decoration>[] {
  const item = node.node.parent;
  const task = item?.getChild("Task")?.getChild("TaskMarker");
  if (task) {
    const done = state.sliceDoc(task.from + 1, task.from + 2) !== " ";
    return [(done ? DONE_TASK : OPEN_TASK).range(node.from, task.to)];
  }
  return item?.parent?.name === "BulletList"
    ? [BULLET.range(node.from, node.to)]
    : [];
}

/**
 * An ATX heading's `#`s, with the spaces after them, or its closing `#`s,
 * with the spaces before them: never a setext heading's underline, nor the
 * `#` of a heading without text, whose line would then show nothing, at
 * the text's height rather than the heading's.
 */
function headerMark(state: EditorState, node: SyntaxNodeRef): Stretch[] {
  const heading = node.node.parent;
  const opening = heading?.firstChild;
  if (!heading?.name.startsWith("ATXHeading") || !opening) return [];
  const last = heading.lastChild;
  const closing =
    last?.name === "HeaderMark" && last.from !== opening.from
      ? last
      : undefined;
  const text = state.sliceDoc(opening.to, closing?.from ?? heading.to);
  const before = text.length - text.trimStart().length;
  if (before === text.length) return [];
  return [
    node.from === opening.from
      ? { from: opening.from, to: opening.to + before }
      : { from: opening.to + text.trimEnd().length, to: node.to },
  ];
}

/**
 * An inline link's `[` and its `](address "title")`, which leave its text:
 * never those of a link without text, which would show nothing, nor of a
 * reference link, whose address is written elsewhere.
 */
function linkSyntax(node: SyntaxNodeRef): Stretch[] {
  const [opening, closing] = node.node.getChildren("LinkMark");
  if (!opening || !closing || closing.from === opening.to) return [];
  if (!node.node.getChild("URL")) return [];
  return [opening, { from: closing.from, to: node.to }];
}
