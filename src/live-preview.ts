import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";

interface Stretch {
  from: number;
  to: number;
}

const HIDDEN = Decoration.replace({});

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
 * Visual: the note as it reads, its Markdown hidden off the lines being
 * written, a hidden symbol being one unit, which the cursor skips and no
 * edit splits.
 */
export const livePreview: Extension = [
  hiding,
  EditorView.atomicRanges.of(
    (view) => view.plugin(hiding)?.decorations ?? Decoration.none,
  ),
];

function hidden(view: EditorView): DecorationSet {
  const { state } = view;
  const writing = view.hasFocus ? linesWritten(state) : [];
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const stretch = symbol(state, node);
        if (
          stretch &&
          !writing.some(
            (line) => stretch.from <= line.to && stretch.to >= line.from,
          )
        ) {
          ranges.push(HIDDEN.range(stretch.from, stretch.to));
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
 * The stretch a symbol of Visual takes: emphasis' `*` and `_`,
 * strikethrough's `~~`, inline code's backticks and a heading's `#`.
 */
function symbol(state: EditorState, node: SyntaxNodeRef): Stretch | undefined {
  switch (node.name) {
    case "EmphasisMark":
    case "StrikethroughMark":
      return node;
    case "CodeMark":
      return node.node.parent?.name === "InlineCode" ? node : undefined;
    case "HeaderMark":
      return headerMark(state, node);
    default:
      return undefined;
  }
}

/**
 * An ATX heading's `#`s, with the spaces after them, or its closing `#`s,
 * with the spaces before them: never a setext heading's underline, nor the
 * `#` of a heading without text, whose line would then show nothing, at
 * the text's height rather than the heading's.
 */
function headerMark(
  state: EditorState,
  node: SyntaxNodeRef,
): Stretch | undefined {
  const heading = node.node.parent;
  const opening = heading?.firstChild;
  if (!heading?.name.startsWith("ATXHeading") || !opening) return undefined;
  const last = heading.lastChild;
  const closing =
    last?.name === "HeaderMark" && last.from !== opening.from
      ? last
      : undefined;
  const text = state.sliceDoc(opening.to, closing?.from ?? heading.to);
  const before = text.length - text.trimStart().length;
  if (before === text.length) return undefined;
  return node.from === opening.from
    ? { from: opening.from, to: opening.to + before }
    : { from: opening.to + text.trimEnd().length, to: node.to };
}
