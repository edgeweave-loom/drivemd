import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  EditorState,
  StateEffect,
  type Extension,
  type Range,
} from "@codemirror/state";
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

// The last finger has lifted from the text.
const lifted = StateEffect.define();

// How long the line a finger pressed stays put after it lifts, while the
// tap moves the cursor there.
const ANCHORED_MS = 500;

// Until when a finger is down on the text or has just lifted from it, in
// any editor: a transaction cannot tell which view it is for.
let touchedUntil = 0;

/** The line a finger pressed, and its top down the page as it pressed. */
interface Anchor {
  at: number;
  top: number;
}

/**
 * Visual's symbols, hidden where the screen shows them, but on the lines
 * the selection touches while the editor has the focus, where the note is
 * being written. Those lines stay as they are while a finger is down: under
 * a long press, iOS places the cursor, then selects the word under the
 * finger, which the line showing its symbols would have moved away (seen
 * in the iOS 27 simulator, #274). As other lines show or hide their
 * symbols, the line pressed stays under the finger, as far as the page
 * scrolls: the lines above it would otherwise move it (#275).
 */
const hiding = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    writing: Stretch[];
    touching = false;
    anchor: Anchor | null = null;
    readonly view: EditorView;
    // On the document, which a touch lifting elsewhere, or from a line drawn
    // anew meanwhile, still reaches.
    readonly lift = (event: TouchEvent) => {
      if (!this.touching || event.touches.length > 0) return;
      this.touching = false;
      touchedUntil = Date.now() + ANCHORED_MS;
      if (!sameLines(written(this.view), this.writing)) {
        this.view.dispatch({ effects: [lifted.of(null), stayAt(this.view)] });
      }
    };
    constructor(view: EditorView) {
      this.view = view;
      this.writing = written(view);
      this.decorations = hidden(view, this.writing);
      for (const type of ["touchend", "touchcancel"] as const) {
        document.addEventListener(type, this.lift, true);
      }
    }
    update(update: ViewUpdate) {
      const lift = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(lifted)),
      );
      const moved = update.selectionSet || update.focusChanged;
      if (update.docChanged) this.anchor = null;
      if (update.docChanged || lift || (moved && !this.touching)) {
        const writing = written(update.view);
        if (!sameLines(writing, this.writing)) this.keep(update.view);
        this.writing = writing;
      }
      if (
        update.docChanged ||
        update.viewportChanged ||
        moved ||
        lift ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = hidden(update.view, this.writing);
      }
    }
    press(event: TouchEvent) {
      this.touching = true;
      touchedUntil = Infinity;
      // A finger that starts a gesture, rather than joins one.
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      const at =
        touch && this.view.posAtCoords({ x: touch.clientX, y: touch.clientY });
      this.anchor =
        at === null || at === undefined
          ? null
          : { at, top: pageTop(this.view, at) };
    }
    /**
     * Scrolls the page by as much as the line pressed moved down it, once
     * drawn anew: not by the page's own scrolls meanwhile, such as iOS's to
     * the cursor.
     */
    keep(view: EditorView) {
      const { anchor } = this;
      if (!anchor || Date.now() > touchedUntil) return;
      view.requestMeasure({
        key: this,
        read: () => pageTop(view, anchor.at) - anchor.top,
        write: (shift) => {
          if (Math.abs(shift) >= 1) window.scrollBy(0, shift);
        },
      });
    }
    destroy() {
      for (const type of ["touchend", "touchcancel"] as const) {
        document.removeEventListener(type, this.lift, true);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Observed, so that scrolling from the text never waits for the page.
    eventObservers: {
      touchstart(event) {
        this.press(event);
      },
    },
  },
);

/**
 * CodeMirror otherwise keeps the line at the screen's top where it was as
 * lines change, the page scrolling for it, as well as for the line pressed:
 * a scroll to the cursor, which a tap leaves on the screen, comes instead.
 * A mouse's selections scroll as CodeMirror scrolls them, as while a drag
 * goes past the window's edge.
 */
function stayAt(view: EditorView): StateEffect<unknown> {
  return EditorView.scrollIntoView(view.state.selection.main);
}

const scrollingInstead = EditorState.transactionExtender.of((transaction) =>
  transaction.selection &&
  transaction.isUserEvent("select") &&
  !transaction.scrollIntoView &&
  Date.now() <= touchedUntil
    ? { effects: EditorView.scrollIntoView(transaction.newSelection.main) }
    : null,
);

/** Where the line at `at` starts, down the page. */
function pageTop(view: EditorView, at: number): number {
  return view.lineBlockAt(at).top + view.documentTop + window.scrollY;
}

function sameLines(one: Stretch[], other: Stretch[]): boolean {
  return (
    one.length === other.length &&
    one.every(
      (line, at) => line.from === other[at]?.from && line.to === other[at].to,
    )
  );
}

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
  scrollingInstead,
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

/** The lines being written, which the selection touches while focused. */
function written(view: EditorView): Stretch[] {
  return view.hasFocus ? linesWritten(view.state) : [];
}

function hidden(view: EditorView, writing: Stretch[]): DecorationSet {
  const { state } = view;
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
