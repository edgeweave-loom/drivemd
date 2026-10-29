import {
  defaultKeymap,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { highlightingFor, syntaxTree } from "@codemirror/language";
import { searchPanelOpen } from "@codemirror/search";
import {
  Annotation,
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
  type StateEffectType,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type Command,
  type DecorationSet,
  type Rect,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import { findInNote } from "./find.ts";
import { TOUCH } from "./layout.ts";

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
 * A thematic break, drawn as the viewer's rule: its marks stay as text,
 * unseen, one unit that a finger's tap places the cursor at, on its line:
 * Playwright's WebKit took a tap on a widget filling the line to the note's
 * start. A screen reader reads it as a separator.
 */
const RULE = Decoration.mark({
  class: "cm-rule",
  attributes: { role: "separator" },
});
const RULE_LINE = Decoration.line({ class: "cm-rule-line" });

// A quote's lines, by how many quotes drawn they are in: deeper ones draw
// as many bars as the last.
const QUOTE_LINES = [1, 2, 3, 4, 5, 6].map((depth) =>
  Decoration.line({ class: `cm-quote cm-quote-${String(depth)}` }),
);

/**
 * Visual's quotes, their lines barred as the viewer's, a bar per level,
 * whether or not their marks show: a lazy line, which continues a quote
 * without its `>`, is in it.
 */
const quoting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = quoteLines(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = quoteLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function quoteLines(view: EditorView): DecorationSet {
  const { state } = view;
  const { from, to } = view.viewport;
  // Each line's start, with how many quotes drawn it is in.
  const depths = new Map<number, number>();
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "Blockquote" || !drawnQuote(node.node)) return;
      const last = Math.min(to, node.to);
      for (let at = Math.max(from, node.from); at <= last;) {
        const line = state.doc.lineAt(at);
        depths.set(line.from, (depths.get(line.from) ?? 0) + 1);
        at = line.to + 1;
      }
    },
  });
  const ranges: Range<Decoration>[] = [];
  for (const [at, depth] of depths) {
    const line = QUOTE_LINES[Math.min(depth, QUOTE_LINES.length) - 1];
    if (line) ranges.push(line.range(at));
  }
  return Decoration.set(ranges, true);
}

/**
 * Whether Visual draws a quote: at the note's top, or in quotes drawn, but
 * not in a list, whose lines start with its marks.
 */
function drawnQuote(quote: SyntaxNode): boolean {
  let around: SyntaxNode | null = quote;
  while (around?.name === "Blockquote") around = around.parent;
  return around?.name === "Document";
}

// The last finger has lifted from the text.
const lifted = StateEffect.define();

// How long the lines stay as they are once a finger lifts from a long
// press, while iOS sets its selection again.
const SETTLING_MS = 300;

// How long a finger rests before iOS takes it for a long press, as UIKit
// does by default.
const LONG_PRESS_MS = 500;

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
 * scrolls: the lines above it would otherwise move it (#275). They stay a
 * moment longer once it lifts from a long press, or from a word selected:
 * iOS then sets the selection again, the word's or the cursor its loupe
 * moved, from where it was on the line, which showing its symbols first
 * moved too. Scrolls into view wait as long as the lines, as when a long
 * press brings the keyboard back up: the text would move under the finger,
 * and the selection with it (seen on an iPhone, #274).
 */
const hiding = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    writing: Stretch[];
    touching = false;
    anchor: Anchor | null = null;
    settling: number | undefined;
    pressed = 0;
    // A scroll into view put off while a finger is down.
    owed = false;
    // A key pressed or an edit made since the finger pressed.
    typed = false;
    readonly view: EditorView;
    // On the document, which a touch lifting elsewhere, or from a line drawn
    // anew meanwhile, still reaches.
    readonly lift = (event: TouchEvent) => {
      if (!this.touching || event.touches.length > 0) return;
      window.clearTimeout(this.settling);
      const tapped = Date.now() - this.pressed < LONG_PRESS_MS;
      if (tapped && this.view.state.selection.main.empty) this.release();
      else this.settling = window.setTimeout(this.release, SETTLING_MS);
    };
    readonly release = () => {
      this.touching = false;
      touchedUntil = Date.now() + ANCHORED_MS;
      const { owed } = this;
      this.owed = false;
      if (owed || !sameLines(written(this.view), this.writing)) {
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
      if (update.docChanged) {
        this.anchor = null;
        this.typed = true;
      }
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
      window.clearTimeout(this.settling);
      this.touching = true;
      touchedUntil = Infinity;
      this.typed = false;
      // A finger that starts a gesture, rather than joins one.
      if (event.touches.length !== 1) return;
      this.pressed = Date.now();
      const touch = event.changedTouches[0];
      const at =
        touch && this.view.posAtCoords({ x: touch.clientX, y: touch.clientY });
      // A table keeps the row tapped under the finger itself.
      this.anchor =
        at === null || at === undefined || tableCell(event.target)
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
    /**
     * Whether a scroll into view waits while a finger is down. After a key
     * or an edit, none does until the next press, should iOS have lost the
     * lift.
     */
    putOff(): boolean {
      if (!this.touching || this.typed) return false;
      this.owed = true;
      return true;
    }
    destroy() {
      window.clearTimeout(this.settling);
      for (const type of ["touchend", "touchcancel"] as const) {
        document.removeEventListener(type, this.lift, true);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.scrollHandler.of(
        (view) => view.plugin(plugin)?.putOff() ?? false,
      ),
    // Observed, so that scrolling from the text never waits for the page.
    eventObservers: {
      touchstart(event) {
        this.press(event);
      },
      keydown() {
        this.typed = true;
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

// How far a finger may move on a task's box and still tap it, as Android's
// touch slop.
const TAP_SLOP_PX = 8;

/** Where and when a finger pressed. */
interface Press {
  x: number;
  y: number;
  at: number;
}

/**
 * Whether the last finger lifting ends a tap, from where and when it
 * pressed: not after moving, nor after staying down as long as a long press.
 */
function tapped(event: TouchEvent, press: Press | null): boolean {
  const touch = event.changedTouches[0];
  if (!press || !touch || event.touches.length > 0) return false;
  if (Date.now() - press.at >= LONG_PRESS_MS) return false;
  return (
    Math.hypot(touch.clientX - press.x, touch.clientY - press.y) <= TAP_SLOP_PX
  );
}

// Until the finger lifts: one box at a time, in any editor.
let boxPressed: Press | null = null;

function isTaskBox(target: EventTarget | null): target is HTMLInputElement {
  return (
    target instanceof HTMLInputElement && target.classList.contains("cm-task")
  );
}

/**
 * A tap on a task's box ticks the task, as one edit that undo reverts,
 * where the cursor stays: neither the focus nor the selection moves, nor
 * does the box but with the text. A finger's tap ticks it as it lifts,
 * the touch's start kept from the browser, which then neither focuses,
 * scrolls nor sends mouse events: Chrome on Android otherwise brings up the
 * keyboard that Back hid, and does so too if the touch's end is kept from
 * it (seen in the Android emulator, #281). A finger that moves, or stays
 * down as long as a long press, leaves the task as it is.
 */
const ticking = EditorView.domEventHandlers({
  touchstart(event) {
    const touch = event.changedTouches[0];
    boxPressed = null;
    if (!isTaskBox(event.target) || event.touches.length !== 1 || !touch) {
      return false;
    }
    event.preventDefault();
    boxPressed = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    return true;
  },
  touchend(event, view) {
    const press = boxPressed;
    boxPressed = null;
    if (!isTaskBox(event.target) || !tapped(event, press)) return false;
    tick(view, view.posAtDOM(event.target));
    // Handled, which CodeMirror would keep from the browser.
    return false;
  },
  mousedown(event, view) {
    if (!isTaskBox(event.target)) return false;
    event.preventDefault();
    tick(view, view.posAtDOM(event.target));
    return true;
  },
  click(event) {
    if (!isTaskBox(event.target)) return false;
    event.preventDefault();
    return true;
  },
});

/**
 * A part of a cell's text, drawn in the editor's highlighting, or null for
 * a line break, which a tag such as `<br>` draws.
 */
type Part = { text: string; style: string | null } | null;

export type Alignment = "left" | "right" | "center" | null;

// The table each frame drawn shows, from which a cell edited in place is
// drawn again as its editor closes.
const drawing = new WeakMap<Element, Table>();

/**
 * A table, drawn as the viewer draws it, whose cells a tap or a click
 * edits in place.
 */
class Table extends WidgetType {
  readonly source: string;
  readonly alignments: Alignment[];
  // The head's row, then the body's, each cell's text in parts.
  readonly rows: Part[][][];
  constructor(source: string, alignments: Alignment[], rows: Part[][][]) {
    super();
    this.source = source;
    this.alignments = alignments;
    this.rows = rows;
  }
  override eq(other: Table): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    // A table wider than the note scrolls sideways within this frame.
    const frame = document.createElement("div");
    frame.className = "cm-table";
    const table = document.createElement("table");
    const head = table.createTHead();
    const body = table.createTBody();
    const columns = this.rows[0]?.length ?? 0;
    this.rows.forEach((_, at) => {
      const row = (at === 0 ? head : body).insertRow();
      for (let column = 0; column < columns; column++) {
        const cell = document.createElement(at === 0 ? "th" : "td");
        this.fill(cell, at, column);
        row.append(cell);
      }
    });
    frame.append(table);
    drawing.set(frame, this);
    return frame;
  }
  /** Draws a cell's text, aligned as its column. */
  fill(cell: HTMLTableCellElement, row: number, column: number): void {
    cell.style.textAlign = this.alignments[column] ?? "";
    cell.replaceChildren(
      ...(this.rows[row]?.[column] ?? []).map((part) => {
        if (part === null) return document.createElement("br");
        if (part.style === null) return part.text;
        const span = document.createElement("span");
        span.className = part.style;
        span.textContent = part.text;
        return span;
      }),
    );
  }
  /**
   * Draws the cells around one edited in place anew, that cell keeping its
   * editor, while the table keeps its rows and columns.
   */
  override updateDOM(dom: HTMLElement): boolean {
    const table = dom.querySelector("table");
    if (!table?.querySelector(".cm-editor")) return false;
    const rows = [...table.rows];
    const columns = this.rows[0]?.length ?? 0;
    if (
      rows.length !== this.rows.length ||
      rows.some((row) => row.cells.length !== columns)
    ) {
      return false;
    }
    // As typed in a cell, the other cells but rarely change.
    const before = drawing.get(dom);
    const same = (row: number, column: number) =>
      before !== undefined &&
      before.alignments[column] === this.alignments[column] &&
      JSON.stringify(before.rows[row]?.[column]) ===
        JSON.stringify(this.rows[row]?.[column]);
    rows.forEach((row, at) => {
      for (const cell of row.cells) {
        const column = cell.cellIndex;
        if (cell.querySelector(".cm-editor")) {
          // Its editor stays, aligned as its column now is, as after Undo.
          cell.style.textAlign = this.alignments[column] ?? "";
        } else if (!same(at, column)) {
          this.fill(cell, at, column);
        }
      }
    });
    drawing.set(dom, this);
    return true;
  }
  // A cell's editor goes with its table.
  override destroy(dom: HTMLElement): void {
    for (const element of dom.querySelectorAll<HTMLElement>(".cm-editor")) {
      EditorView.findFromDOM(element)?.destroy();
    }
  }
  override get estimatedHeight(): number {
    return this.rows.length * 42;
  }
  // The editor takes its cells' taps and clicks, which edit them, and
  // leaves the browser the rest, such as its scroll bar's, and a cell's
  // editor its own.
  override ignoreEvent(event: Event): boolean {
    return (
      tableCell(event.target) === null ||
      (event.target instanceof Element &&
        event.target.closest(".cm-table .cm-editor") !== null)
    );
  }
}

/** A field that `effect` sets, false at first. */
function flag(effect: StateEffectType<boolean>): StateField<boolean> {
  return StateField.define<boolean>({
    create: () => false,
    update: (value, transaction) =>
      transaction.effects.reduce(
        (set, one) => (one.is(effect) ? one.value : set),
        value,
      ),
  });
}

const focused = StateEffect.define<boolean>();

// Whether the editor has the focus, which a state field cannot ask the view.
const hasFocus = flag(focused);

/**
 * Tells `hasFocus` of the view's focus once it changes. CodeMirror's own
 * focus transaction is dropped when another comes first, as when the
 * cursor moves right as the editor takes the focus.
 */
const followingFocus = ViewPlugin.define((view) => {
  const follow = () => {
    queueMicrotask(() => {
      const has = view.state.field(hasFocus, false);
      if (has !== undefined && has !== view.hasFocus) {
        view.dispatch({ effects: focused.of(view.hasFocus) });
      }
    });
  };
  follow();
  return {
    update: (update) => {
      const has = update.state.field(hasFocus, false);
      if (has !== undefined && has !== update.view.hasFocus) follow();
    },
  };
});

/**
 * Visual's tables, drawn but where the selection is while the editor has
 * the focus, or while Find in note is open, so that its match shows. A
 * table replaces lines, which only a state field may. A table in a quote
 * or a list, whose lines start with their marks, stays as written. A
 * table is no unit: an edit beside it never takes it whole.
 */
const tables = StateField.define<DecorationSet>({
  create: (state) => drawnTables(state),
  update: (drawn, transaction) => {
    const { state, startState } = transaction;
    return transaction.docChanged ||
      transaction.selection ||
      state.field(hasFocus) !== startState.field(hasFocus, false) ||
      searchPanelOpen(state) !== searchPanelOpen(startState) ||
      syntaxTree(state) !== syntaxTree(startState)
      ? drawnTables(state, drawn)
      : drawn;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Each table outside the lines being written, drawn, with the widget drawn
 * before for the same Markdown, which is kept rather than built anew.
 */
function drawnTables(
  state: EditorState,
  before: DecorationSet = Decoration.none,
): DecorationSet {
  const kept = new Map<string, WidgetType>();
  const drawn = before.iter();
  while (drawn.value) {
    const { widget } = drawn.value.spec as { widget?: unknown };
    if (widget instanceof Table) kept.set(widget.source, widget);
    drawn.next();
  }
  const writing =
    state.field(hasFocus) || searchPanelOpen(state) ? linesWritten(state) : [];
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") {
        // The note, its front matter's or its Markdown's, but no block in it.
        return node.name === "Document" || node.name === "Body";
      }
      // An indented table's lines whole.
      const from = state.doc.lineAt(node.from).from;
      const { to } = node;
      if (writing.some((line) => from <= line.to && to >= line.from)) {
        return false;
      }
      const widget =
        kept.get(state.sliceDoc(node.from, to)) ?? table(state, node.node);
      ranges.push(Decoration.replace({ widget, block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(ranges);
}

function table(state: EditorState, node: SyntaxNode): Table {
  const [header, delimiter, ...body] = tableRows(node);
  const columns = header ? cellsOf(state, header).length : 0;
  return new Table(
    state.sliceDoc(node.from, node.to),
    delimiter ? alignments(state.sliceDoc(delimiter.from, delimiter.to)) : [],
    [header, ...body].flatMap((row) =>
      row
        ? [
            cellsOf(state, row)
              .slice(0, columns)
              .map((cell) => parts(state, trimmed(state, cell))),
          ]
        : [],
    ),
  );
}

/** A table's lines' nodes: its head, its delimiter row, then its rows. */
function tableRows(node: SyntaxNode): SyntaxNode[] {
  const rows: SyntaxNode[] = [];
  for (let row = node.firstChild; row; row = row.nextSibling) rows.push(row);
  return rows;
}

/** Each cell of a row, between its pipes, with the spaces around its text. */
function cellsOf(state: EditorState, row: SyntaxNode): Stretch[] {
  const pipes =
    row.name === "TableDelimiter"
      ? // The delimiter row, whose pipes Lezer leaves unmarked.
        [...state.sliceDoc(row.from, row.to).matchAll(/\|/g)].map(
          ({ index }) => row.from + index,
        )
      : row.getChildren("TableDelimiter").map((pipe) => pipe.from);
  const cells: Stretch[] = [];
  let from = row.from;
  for (const pipe of pipes) {
    cells.push({ from, to: pipe });
    from = pipe + 1;
  }
  cells.push({ from, to: row.to });
  const blank = (cell: Stretch | undefined) =>
    cell !== undefined && !state.sliceDoc(cell.from, cell.to).trim();
  // Neither before a leading pipe nor after a closing one is a cell.
  if (pipes.length > 0 && blank(cells[0])) cells.shift();
  if (pipes.length > 0 && blank(cells.at(-1))) cells.pop();
  return cells;
}

function trimmed(state: EditorState, { from, to }: Stretch): Stretch {
  const text = state.sliceDoc(from, to);
  const start = from + text.length - text.trimStart().length;
  return { from: start, to: Math.max(start, from + text.trimEnd().length) };
}

/** Each column's alignment, from the delimiter row's colons. */
function alignments(delimiter: string): Alignment[] {
  return delimiter
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((column) => {
      const marks = column.trim();
      const left = marks.startsWith(":");
      const right = marks.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      return left ? "left" : null;
    });
}

// A tag that the viewer draws as a line break, as `<br>`, `<br />` or
// `</br>`.
const LINE_BREAK = /^<\/?br[\s/>]/i;

/**
 * A cell's text in the editor's highlighting, its symbols hidden as Visual
 * hides them, and as the viewer does, an escape's backslash, so that an
 * escaped pipe shows in its cell, and a tag such as `<br>` a line break,
 * which no row can hold otherwise.
 */
function parts(state: EditorState, { from, to }: Stretch): Part[] {
  const hidden: Stretch[] = [];
  const breaks = new Set<number>();
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "Escape") {
        hidden.push({ from: node.from, to: node.from + 1 });
      }
      if (
        node.name === "HTMLTag" &&
        LINE_BREAK.test(state.sliceDoc(node.from, node.to))
      ) {
        hidden.push({ from: node.from, to: node.to });
        breaks.add(node.from);
      }
      for (const symbol of symbols(state, node)) {
        if (symbol.value === HIDDEN) hidden.push(symbol);
      }
    },
  });
  const styled: (Stretch & { style: string })[] = [];
  highlightTree(
    syntaxTree(state),
    { style: (tags) => highlightingFor(state, tags) },
    (start, end, style) => {
      styled.push({ from: start, to: end, style });
    },
    from,
    to,
  );
  const edges = new Set([from, to]);
  for (const stretch of [...hidden, ...styled]) {
    edges.add(Math.min(to, Math.max(from, stretch.from)));
    edges.add(Math.min(to, Math.max(from, stretch.to)));
  }
  const sorted = [...edges].sort((one, other) => one - other);
  const result: Part[] = [];
  sorted.slice(1).forEach((end, at) => {
    const start = sorted[at] ?? from;
    if (breaks.has(start)) {
      result.push(null);
      return;
    }
    const covers = (range: Stretch) => range.from <= start && range.to >= end;
    if (hidden.some(covers)) return;
    const style = styled.find(covers)?.style ?? null;
    const text = state.sliceDoc(start, end);
    const previous = result.at(-1);
    if (previous?.style === style) previous.text += text;
    else result.push({ text, style });
  });
  return result;
}

/** The cell of a table drawn that an event's target is in, if any. */
function tableCell(target: EventTarget | null): HTMLTableCellElement | null {
  return target instanceof Element
    ? target.closest<HTMLTableCellElement>(".cm-table :is(td, th)")
    : null;
}

/** Where a cell drawn is in its table: its row, the head's first. */
interface Place {
  row: number;
  column: number;
}

function placeOf(cell: HTMLTableCellElement): Place | null {
  const row = cell.parentElement;
  return row instanceof HTMLTableRowElement
    ? { row: row.rowIndex, column: cell.cellIndex }
    : null;
}

/**
 * The table drawn in `frame`, in the note's syntax tree: from its first
 * line, past its indent, which the frame draws but the table lacks.
 */
function tableIn(view: EditorView, frame: Element): SyntaxNode | null {
  const { from, text } = view.state.doc.lineAt(view.posAtDOM(frame));
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
    from + text.length - text.trimStart().length,
    1,
  );
  while (node && node.name !== "Table") node = node.parent;
  return node;
}

/** The frame of the table drawn from `from` on, if in view. */
function frameAt(view: EditorView, from: number): Element | undefined {
  return [...view.contentDOM.querySelectorAll(".cm-table")].find(
    (frame) => view.posAtDOM(frame) === from,
  );
}

/** A row's line in its table: the head's, or a body's after the delimiter row. */
function rowOf(table: SyntaxNode, row: number): SyntaxNode | undefined {
  return tableRows(table)[row === 0 ? 0 : row + 1];
}

/**
 * A cell's text in the note, without the spaces around it: in a blank
 * cell, after its first space, if any. None for a cell its row lacks.
 */
function cellText(
  state: EditorState,
  table: SyntaxNode,
  { row, column }: Place,
): Stretch | null {
  const line = rowOf(table, row);
  const cell = line && cellsOf(state, line)[column];
  if (!cell) return null;
  if (state.sliceDoc(cell.from, cell.to).trim()) return trimmed(state, cell);
  const at = Math.min(cell.to, cell.from + 1);
  return { from: at, to: at };
}

/** What the table's menu does to the cell edited in place. */
export type TableEdit =
  | "addRowAbove"
  | "addRowBelow"
  | "moveRowUp"
  | "moveRowDown"
  | "deleteRow"
  | "addColumnLeft"
  | "addColumnRight"
  | "moveColumnLeft"
  | "moveColumnRight"
  | "deleteColumn"
  | "alignLeft"
  | "alignCenter"
  | "alignRight";

/** The edits that apply to a cell, and its column's alignment. */
export interface CellMenu {
  edits: ReadonlySet<TableEdit>;
  alignment: Alignment;
}

/**
 * The edits that apply to the cell at `place`, in a table of `rows`, its
 * head's included, and `columns`: nothing moves the head or comes above
 * it, since a GFM table starts with its head and its delimiter row, and a
 * table keeps a column.
 */
function editsAt(
  { row, column }: Place,
  rows: number,
  columns: number,
): Set<TableEdit> {
  const edits: [TableEdit, boolean][] = [
    ["addRowAbove", row > 0],
    ["addRowBelow", true],
    ["moveRowUp", row > 1],
    ["moveRowDown", row > 0 && row < rows - 1],
    ["deleteRow", row > 0],
    ["addColumnLeft", true],
    ["addColumnRight", true],
    ["moveColumnLeft", column > 0],
    ["moveColumnRight", column < columns - 1],
    ["deleteColumn", columns > 1],
    ["alignLeft", true],
    ["alignCenter", true],
    ["alignRight", true],
  ];
  return new Set(edits.flatMap(([edit, applies]) => (applies ? [edit] : [])));
}

/**
 * A table's line as written, past its indent: its text, its cells in it
 * with and without the spaces around their text, and whether a pipe ends
 * it on each side.
 */
interface Written {
  text: string;
  cells: Stretch[];
  texts: Stretch[];
  lead: boolean;
  trail: boolean;
}

function asWritten(state: EditorState, row: SyntaxNode): Written {
  const text = state.sliceDoc(row.from, row.to);
  const within = ({ from, to }: Stretch) => ({
    from: from - row.from,
    to: to - row.from,
  });
  const cells = cellsOf(state, row);
  return {
    text,
    cells: cells.map(within),
    texts: cells.map((cell) => within(trimmed(state, cell))),
    lead: (cells[0]?.from ?? row.from) > row.from,
    trail: (cells.at(-1)?.to ?? row.to) < row.to,
  };
}

/**
 * A line with `cell` as its `at`th, between a space on each side and a
 * pipe, which an empty first or last cell needs on its edge too.
 */
function withCell(line: Written, at: number, cell: string): string {
  const { text, cells, lead, trail } = line;
  const before = cells[at];
  if (before) {
    return at > 0 || lead
      ? `${text.slice(0, before.from)} ${cell} |${text.slice(before.from)}`
      : `| ${cell} | ${text}`;
  }
  const end = (cells.at(-1)?.to ?? text.length) + 1;
  return trail
    ? `${text.slice(0, end)} ${cell} |${text.slice(end)}`
    : `${text} | ${cell} |`;
}

/**
 * A line without its `at`th cell and a pipe beside it. A cell left at an
 * edge without its pipe takes it, at a line's start, where its text could
 * start a list, a heading or a quote, or at its end where empty; a cell
 * left alone pipes on both, without which its line would be no row, or its
 * table no table.
 */
function withoutCell(line: Written, at: number): string {
  const { text, cells, texts, lead, trail } = line;
  if (cells.length === 1) return "|  |";
  if (cells.length === 2 && !(lead && trail)) {
    const kept = texts[1 - at];
    return `| ${kept ? text.slice(kept.from, kept.to) : ""} |`;
  }
  const [gone, before] = [cells[at], texts[at - 1]];
  if (!gone) return text;
  if (cells[at + 1]) {
    // Up to the next cell, past its pipe, or at the line's start, from the
    // pipe after it, which then leads the line.
    return at > 0 || lead
      ? text.slice(0, gone.from) + text.slice(gone.to + 1)
      : text.slice(gone.to);
  }
  // From the pipe before it.
  return (
    text.slice(0, gone.from - 1) +
    (!trail && before && before.from === before.to ? "|" : text.slice(gone.to))
  );
}

/**
 * A line with its `at`th cell and the next one trading places, each with
 * the spaces around it, which a padded table's columns keep. At an edge
 * without its pipe, their texts alone trade places, a space apart from
 * the pipes, so that a backslash ending one escapes none; one coming to
 * the line's start takes the pipe before it, and an empty one at its end
 * the pipe after it.
 */
function swapped(line: Written, at: number): string {
  const { text, cells, texts, lead, trail } = line;
  const [one, other, first, second] = [
    cells[at],
    cells[at + 1],
    texts[at],
    texts[at + 1],
  ];
  if (!one || !other || !first || !second) return text;
  const start = at === 0 && !lead;
  const end = at + 2 === cells.length && !trail;
  if (!start && !end) {
    return [
      text.slice(0, one.from),
      text.slice(other.from, other.to),
      text.slice(one.to, other.from),
      text.slice(one.from, one.to),
      text.slice(other.to),
    ].join("");
  }
  const [was, now] = [
    text.slice(first.from, first.to),
    text.slice(second.from, second.to),
  ];
  if (was === now) return text;
  const before = `${start ? "|" : ""} ${now} `;
  const after = end ? (was ? ` ${was}` : "  |") : ` ${was} `;
  return `${text.slice(0, one.from)}${before}|${after}${text.slice(other.to)}`;
}

/** A delimiter row's cell's marks for `alignment`, as wide as they were. */
function marks(width: number, alignment: Alignment): string {
  const left = alignment === "left" || alignment === "center";
  const right = alignment === "right" || alignment === "center";
  const dashes = Math.max(1, width - Number(left) - Number(right));
  return `${left ? ":" : ""}${"-".repeat(dashes)}${right ? ":" : ""}`;
}

/**
 * The row that a table takes empty, `|  |  |`: the delimiter row's indent,
 * a pipe at each edge, and a space on each side of each cell, whatever the
 * table's own edges, since GFM holds an empty cell between pipes only.
 */
function emptyRow(state: EditorState, table: SyntaxNode): string {
  const [head, delimiter] = tableRows(table);
  if (!head || !delimiter) return "";
  const indent = state.sliceDoc(
    state.doc.lineAt(delimiter.from).from,
    delimiter.from,
  );
  return `${indent}|${"  |".repeat(cellsOf(state, head).length)}`;
}

/** The alignment each of the table's menu's edits of alignment gives. */
export const ALIGNING = {
  alignLeft: "left",
  alignCenter: "center",
  alignRight: "right",
} as const satisfies Partial<Record<TableEdit, Alignment>>;

/**
 * The changes that make `edit` to the cell at `place` of `table`, which
 * write only the lines that must change, and the cell to edit then: the
 * one added or moved, the next in place of one deleted, or in a row too
 * short for it, the row's own.
 */
function tableEdited(
  state: EditorState,
  table: SyntaxNode,
  place: Place,
  edit: TableEdit,
): { changes: ChangeSpec[]; to: Place } {
  const { row, column } = place;
  const lines = tableRows(table);
  const columns = lines[0] ? cellsOf(state, lines[0]).length : 0;
  const { doc, lineBreak } = state;
  const line = (at: number) => doc.lineAt(rowOf(table, at)?.from ?? table.to);
  // Every line, as `write` writes it given its place: the head's 0, the
  // delimiter row's 1.
  const rewritten = (write: (line: Written, at: number) => string) =>
    lines.flatMap((one, at) => {
      const was = asWritten(state, one);
      const text = write(was, at);
      return text === was.text
        ? []
        : [{ from: one.from, to: one.to, insert: text }];
    });
  switch (edit) {
    case "addRowAbove":
      return {
        changes: [
          { from: line(row).from, insert: emptyRow(state, table) + lineBreak },
        ],
        to: place,
      };
    case "addRowBelow": {
      // Under the head, past the delimiter row.
      const { to } = doc.lineAt((lines[row + 1] ?? table).to);
      return {
        changes: [{ from: to, insert: lineBreak + emptyRow(state, table) }],
        to: { row: row + 1, column },
      };
    }
    case "moveRowUp":
    case "moveRowDown": {
      const by = edit === "moveRowUp" ? -1 : 1;
      const [one, other] = [line(row), line(row + by)];
      return {
        changes: [
          { from: one.from, to: one.to, insert: other.text },
          { from: other.from, to: other.to, insert: one.text },
        ],
        to: { row: row + by, column },
      };
    }
    case "deleteRow": {
      const gone = line(row);
      return {
        changes: [{ from: gone.from - 1, to: gone.to }],
        to: { row: row < lines.length - 2 ? row : row - 1, column },
      };
    }
    case "addColumnLeft":
    case "addColumnRight": {
      const at = column + Number(edit === "addColumnRight");
      return {
        changes: rewritten((one, index) =>
          index < 2 || one.cells.length > at
            ? withCell(one, at, index === 1 ? "---" : "")
            : one.text,
        ),
        to: { row, column: at },
      };
    }
    case "moveColumnLeft":
    case "moveColumnRight": {
      const at = edit === "moveColumnLeft" ? column - 1 : column;
      return {
        // A row with the first cell but not the next leaves the first's
        // place empty.
        changes: rewritten((one) =>
          one.cells.length > at + 1
            ? swapped(one, at)
            : one.cells.length > at
              ? withCell(one, at, "")
              : one.text,
        ),
        to: { row, column: at === column ? column + 1 : at },
      };
    }
    case "deleteColumn":
      return {
        changes: rewritten((one) =>
          one.cells.length > column ? withoutCell(one, column) : one.text,
        ),
        to: { row, column: column === columns - 1 ? column - 1 : column },
      };
    default: {
      const alignment = ALIGNING[edit];
      return {
        // The delimiter row's cell alone, the same alignment writing the
        // same marks.
        changes: rewritten((one, index) => {
          const marked = one.texts[column];
          return index === 1 && marked
            ? one.text.slice(0, marked.from) +
                marks(marked.to - marked.from, alignment) +
                one.text.slice(marked.to)
            : one.text;
        }),
        to: place,
      };
    }
  }
}

/** Extensions of a cell's editor: the note's language and styling. */
export const cellSetup = Facet.define<Extension>();

// A cell's edit, which the note already holds, or the note's, which the
// cell already holds.
const fromCell = Annotation.define<boolean>();
const fromNote = Annotation.define<boolean>();

const cellFocused = StateEffect.define<boolean>();

// Whether a cell edited in place has the focus, rather than the note.
const inCellField = flag(cellFocused);

/** Whether a table's cell edited in place has the focus. */
export function inCell(state: EditorState): boolean {
  return state.field(inCellField, false) ?? false;
}

/** The editor of the table's cell edited in place, if any. */
export function cellEditor(view: EditorView): EditorView | null {
  return view.plugin(editingCells)?.editing?.cell ?? null;
}

/** The table's menu: opened at a point, for the cell edited in place. */
export interface TableMenuControl {
  openAt: (x: number, y: number) => void;
  close: () => void;
}

export const tableMenu = Facet.define<
  TableMenuControl,
  TableMenuControl | undefined
>({ combine: (values) => values[0] });

/** The table's menu for the cell edited in place, if any. */
export function tableMenuOf(view: EditorView): CellMenu | null {
  const at = view.plugin(editingCells)?.where();
  return at ? cellMenu(view.state, at) : null;
}

/** The table's menu for a cell of a table drawn in `frame`. */
function cellMenu(
  state: EditorState,
  { place, frame, table }: { place: Place; frame: Element; table: SyntaxNode },
): CellMenu {
  const lines = tableRows(table);
  return {
    edits: editsAt(
      place,
      lines.length - 1,
      lines[0] ? cellsOf(state, lines[0]).length : 0,
    ),
    alignment: drawing.get(frame)?.alignments[place.column] ?? null,
  };
}

/**
 * Makes an edit from the table's menu to the cell edited in place:
 * whether it applies.
 */
export function editTable(view: EditorView, edit: TableEdit): boolean {
  return view.plugin(editingCells)?.edit(edit) ?? false;
}

/**
 * Once the table's menu has closed, gives the focus `back` to the cell
 * edited, which stays edited, or else closes it.
 */
export function tableMenuClosed(view: EditorView, back: boolean): void {
  view.plugin(editingCells)?.released(back);
}

/** Whether a finger's long press asks for the menu, which is the system's. */
function pressedLong(event: MouseEvent): boolean {
  return (event as Partial<PointerEvent>).pointerType === "touch";
}

/**
 * The changes that keep a cell's text in its cell, as GFM and Lezer read a
 * row, counting backslashes: a line break, which would end the row, turns
 * into the viewer's `<br>`, after a space past an odd run of backslashes,
 * which would escape its `<`; a pipe after an even run, which
 * would end the cell, is escaped; and an odd run at the text's end, which
 * would escape the pipe `after` it, takes a space.
 */
function keptInCell(text: string, after: string): ChangeSpec[] {
  const fixes: ChangeSpec[] = [];
  let escaped = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\n") {
      fixes.push({ from: at, to: at + 1, insert: escaped ? " <br>" : "<br>" });
    } else if (char === "|" && !escaped) {
      fixes.push({ from: at, insert: "\\" });
    }
    escaped = !escaped && char === "\\";
  }
  if (escaped && after === "|") fixes.push({ from: text.length, insert: " " });
  return fixes;
}

/** A cell edited in place, its editor, and its text's stretch in the note. */
interface Editing extends Stretch {
  cell: EditorView;
  host: HTMLTableCellElement;
}

/** Where a cell's editor opens with its cursor: its text's start or end. */
type Side = "start" | "end";

/** Takes a cell's place to the next one's, in a table of `columns`. */
type Next = (place: Place, columns: number) => Place;

/** From cell to cell, row after row, onward or back. */
function stepping(by: 1 | -1): Next {
  return (place, columns) => {
    const at = place.row * columns + place.column + by;
    return { row: Math.floor(at / columns), column: at % columns };
  };
}

/** From a cell to the one below, or above. */
function rowing(by: 1 | -1): Next {
  return (place) => ({ ...place, row: place.row + by });
}

/** Whether a cell's cursor is at its text's start, or its end. */
function atEdge(cell: EditorView, by: 1 | -1): boolean {
  const { main } = cell.state.selection;
  return main.empty && main.head === (by === 1 ? cell.state.doc.length : 0);
}

/**
 * Edits a table's cells in place, as Obsidian does: a cell tapped or
 * clicked takes an editor of its own, which shows its Markdown, the table
 * drawn around it. Its edits are the note's, which holds the text and its
 * history, so that undo takes them back as any other: a cell's editor
 * holds its cell's text alone, which can thus never take or break a row.
 * Tab moves to the next cell, Shift+Tab to the one before, Enter to the
 * one below, and the arrows to the cell they point to, Left and Right from
 * the text's edge, or out of the table, past cells rows lack. Tab past the
 * last cell, or Enter past the last row, adds a row. Escape shows the
 * table as written.
 */
const editingCells = ViewPlugin.fromClass(
  class {
    editing: Editing | null = null;
    // Whether the table's menu has the focus, the cell edited staying so.
    holding = false;
    // The press whose end the table's menu waits for.
    pressing: AbortController | null = null;
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
    }
    /**
     * Edits a cell drawn, the cursor at its text's `side`, or the one
     * edited where its cursor is. While Find in note is open, as for a cell
     * its row lacks, shows its table as written, the cursor at the cell's
     * end, or at the row's: a table shows so where Find in note's selection
     * is.
     */
    open(host: HTMLTableCellElement, side: Side = "end"): void {
      const { editing, view } = this;
      if (editing?.host === host) {
        editing.cell.focus();
        return;
      }
      const frame = host.closest(".cm-table");
      const place = placeOf(host);
      const table = frame && tableIn(view, frame);
      if (!place || !table) return;
      const text = cellText(view.state, table, place);
      this.close();
      if (!text || searchPanelOpen(view.state)) {
        view.focus();
        view.dispatch({
          selection: {
            anchor: text?.to ?? rowOf(table, place.row)?.to ?? table.to,
          },
        });
        return;
      }
      const doc = view.state.sliceDoc(text.from, text.to);
      const at = side === "start" ? 0 : doc.length;
      host.replaceChildren();
      host.classList.add("cm-cell-edited");
      const cell: EditorView = new EditorView({
        parent: host,
        root: view.root instanceof ShadowRoot ? view.root : document,
        state: EditorState.create({
          doc,
          selection: { anchor: at },
          extensions: this.setup(),
        }),
        dispatchTransactions: (transactions) => {
          this.pass(cell, transactions);
        },
      });
      this.editing = { cell, host, ...text };
      cell.focus();
      view.dispatch({
        selection: { anchor: text.from + at },
        effects: [focused.of(false), cellFocused.of(true)],
      });
    }
    /**
     * Edits the cell of the table drawn from `from` on that an arrow takes
     * the note's cursor to, as Obsidian does: Down the head's under the
     * cursor, Up the last row's, Right the first cell, from its start, and
     * Left the last: whether there is one.
     */
    arrive(from: number, by: 1 | -1, vertical: boolean): boolean {
      const { view } = this;
      const frame = frameAt(view, from);
      const rows = frame?.querySelector("table")?.rows;
      if (!frame || !rows) return false;
      if (!vertical) {
        return by === 1
          ? this.go(frame, { row: 0, column: -1 }, stepping(1), "start")
          : this.go(frame, { row: rows.length, column: 0 }, stepping(-1));
      }
      // Where the cursor's motion goes across, which CodeMirror keeps from
      // line to line, as an arrow out of a cell sets it.
      const { main } = view.state.selection;
      const x =
        main.goalColumn === undefined
          ? (view.coordsAtPos(main.head)?.left ?? 0)
          : view.contentDOM.getBoundingClientRect().left + main.goalColumn;
      const column = [...(rows[0]?.cells ?? [])].findLastIndex(
        (cell) => cell.getBoundingClientRect().left <= x,
      );
      return this.go(
        frame,
        { row: by === 1 ? -1 : rows.length, column: Math.max(0, column) },
        rowing(by),
      );
    }
    setup(): Extension {
      const { view } = this;
      return [
        view.state.facet(cellSetup),
        EditorState.transactionFilter.of((transaction) => {
          const { editing } = this;
          if (
            !editing ||
            !transaction.docChanged ||
            transaction.annotation(fromNote)
          ) {
            return transaction;
          }
          const fixes = keptInCell(
            transaction.newDoc.toString(),
            view.state.sliceDoc(editing.to, editing.to + 1),
          );
          return fixes.length === 0
            ? transaction
            : [transaction, { changes: fixes, sequential: true }];
        }),
        keymap.of([
          { key: "Tab", run: () => this.tab(1), shift: () => this.tab(-1) },
          { key: "Enter", run: () => this.enter() },
          {
            key: "ArrowUp",
            run: () => this.move(rowing(-1)) || this.out(-1, true),
          },
          {
            key: "ArrowDown",
            run: () => this.move(rowing(1)) || this.out(1, true),
          },
          {
            key: "ArrowLeft",
            run: (cell) =>
              atEdge(cell, -1) &&
              (this.move(stepping(-1)) || this.out(-1, false)),
          },
          {
            key: "ArrowRight",
            run: (cell) =>
              atEdge(cell, 1) &&
              (this.move(stepping(1), "start") || this.out(1, false)),
          },
          { key: "Escape", run: () => this.leave() },
          // The note's history and Find in note.
          ...historyKeymap.flatMap(({ run, ...binding }) =>
            run ? [{ ...binding, run: () => run(view) }] : [],
          ),
          { key: "Mod-f", run: () => findInNote(view) },
          ...defaultKeymap,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Cell" }),
        EditorView.domEventHandlers({
          blur: (_event, cell) => {
            // Once the focus has gone where it goes, as to another cell.
            queueMicrotask(() => {
              if (
                this.editing?.cell === cell &&
                !cell.hasFocus &&
                !this.holding
              )
                this.close();
            });
          },
          contextmenu: (event) => {
            const host = this.editing?.host;
            if (!host || pressedLong(event)) return false;
            const shown = this.menuAt(host, event);
            if (shown) event.preventDefault();
            return shown;
          },
        }),
        // The note's, clear of the keyboard toolbar and the app bar.
        EditorView.scrollMargins.of(() => margins(view)),
        ViewPlugin.define((cell) => ({
          destroy: () => {
            this.closed(cell);
          },
        })),
      ];
    }
    /** Makes a cell's edits, and its cursor, the note's. */
    pass(cell: EditorView, transactions: readonly Transaction[]): void {
      for (const transaction of transactions) {
        cell.update([transaction]);
        const { editing } = this;
        if (
          editing?.cell !== cell ||
          transaction.annotation(fromNote) ||
          (!transaction.docChanged && !transaction.selection)
        ) {
          continue;
        }
        const { from } = editing;
        const changes: ChangeSpec[] = [];
        transaction.changes.iterChanges((fromA, toA, _from, _to, text) => {
          changes.push({
            from: from + fromA,
            to: from + toA,
            insert: text.toString(),
          });
        });
        const { anchor, head } = transaction.newSelection.main;
        const userEvent = transaction.annotation(Transaction.userEvent);
        this.view.dispatch({
          changes,
          selection: { anchor: from + anchor, head: from + head },
          annotations: fromCell.of(true),
          // A cursor moved in a cell scrolls the cell, not the note.
          ...(transaction.docChanged && userEvent ? { userEvent } : {}),
        });
      }
    }
    update(update: ViewUpdate) {
      const { editing } = this;
      if (!editing || !update.docChanged) return;
      editing.from = update.changes.mapPos(editing.from, -1);
      editing.to = update.changes.mapPos(editing.to, 1);
      const { cell } = editing;
      const text = update.state.sliceDoc(editing.from, editing.to);
      const passed = update.transactions.every((one) =>
        one.annotation(fromCell),
      );
      if (passed && text === cell.state.sliceDoc()) return;
      // Undone, redone or formatted in the note, as from the keyboard
      // toolbar, or changed by the note's own filters: the cell shows its
      // text and selection as they are now, unless the note's selection
      // left it, or its text its cell. A line break ends its row, which
      // draws the table anew.
      const { anchor, head } = update.state.selection.main;
      const within = (at: number) => at >= editing.from && at <= editing.to;
      const after = update.state.sliceDoc(editing.to, editing.to + 1);
      if (
        !within(anchor) ||
        !within(head) ||
        keptInCell(text, after).length > 0
      ) {
        queueMicrotask(() => {
          if (this.editing !== editing) return;
          this.close();
          this.view.focus();
        });
        return;
      }
      cell.dispatch({
        changes: { from: 0, to: cell.state.doc.length, insert: text },
        selection: { anchor: anchor - editing.from, head: head - editing.from },
        annotations: fromNote.of(true),
      });
    }
    /** Ends the editing of a cell, which shows drawn again. */
    close(): void {
      this.editing?.cell.destroy();
    }
    /** Once a cell's editor is gone, by its table's or by `close`. */
    closed(cell: EditorView): void {
      const { editing, view } = this;
      if (editing?.cell !== cell) return;
      this.editing = null;
      const { host } = editing;
      host.classList.remove("cm-cell-edited");
      const frame = host.closest(".cm-table");
      const place = placeOf(host);
      if (frame && place)
        drawing.get(frame)?.fill(host, place.row, place.column);
      // Its menu, which would edit another cell, shown or waited for.
      this.pressing?.abort();
      view.state.facet(tableMenu)?.close();
      // Never within an update of the note's, nor once another cell is
      // edited, as from Tab.
      queueMicrotask(() => {
        if (!this.editing && view.plugin(editingCells) && inCell(view.state)) {
          view.dispatch({ effects: cellFocused.of(false) });
        }
      });
    }
    /**
     * Tab: edits the next cell, or past the last a new row's first;
     * Shift+Tab the one before. The key is taken either way.
     */
    tab(by: 1 | -1): boolean {
      if (!this.move(stepping(by)) && by === 1) this.addRow(0);
      return true;
    }
    /** Enter: edits the cell below, or past the last row a new row's. */
    enter(): boolean {
      const place = this.editing && placeOf(this.editing.host);
      if (place && !this.move(rowing(1))) this.addRow(place.column);
      return true;
    }
    /**
     * Edits the cell that `next` takes the one edited to, past cells rows
     * lack, its cursor at its text's `side`: whether there is one.
     */
    move(next: Next, side?: Side): boolean {
      const { editing } = this;
      const frame = editing?.host.closest(".cm-table");
      const place = editing && placeOf(editing.host);
      return !!frame && !!place && this.go(frame, place, next, side);
    }
    /**
     * Edits the first cell the table drawn in `frame` holds past `place`,
     * as `next` takes it from cell to cell, scrolled into view, as a key
     * moved to it: whether there is one.
     */
    go(frame: Element, place: Place, next: Next, side?: Side): boolean {
      const { view } = this;
      const table = frame.querySelector("table");
      const node = tableIn(view, frame);
      if (!table || !node) return false;
      const columns = table.rows[0]?.cells.length ?? 1;
      for (;;) {
        place = next(place, columns);
        const host = table.rows[place.row]?.cells[place.column];
        if (!host) return false;
        if (cellText(view.state, node, place)) {
          this.open(host, side);
          this.reveal();
          return true;
        }
      }
    }
    /**
     * Scrolls the cell edited into view, sideways in its table too, clear
     * of the keyboard toolbar. A tap leaves a cell where it was.
     */
    reveal(): void {
      const cell = this.editing?.cell;
      cell?.dispatch({
        effects: EditorView.scrollIntoView(cell.state.selection.main),
      });
    }
    /**
     * Leaves the table for the line before it, or after it, if any: Up and
     * Down above or below the cell's middle, which a right-aligned cell's
     * cursor is not, at the next column's edge; Left at the line's end and
     * Right at its start.
     */
    out(by: 1 | -1, vertical: boolean): boolean {
      const { editing, view } = this;
      const frame = editing?.host.closest(".cm-table");
      const node = frame && tableIn(view, frame);
      if (!editing || !node) return false;
      const { doc } = view.state;
      const number = doc.lineAt(by === 1 ? node.to : node.from).number + by;
      if (number < 1 || number > doc.lines) return false;
      const line = doc.line(number);
      let at = by === 1 ? line.from : line.to;
      let goal: number | undefined;
      if (vertical) {
        const { left, right } = editing.host.getBoundingClientRect();
        const x = (left + right) / 2;
        const block = view.lineBlockAt(line.from);
        const half = view.defaultLineHeight / 2;
        const across = view.posAtCoords(
          {
            x,
            y:
              view.documentTop +
              (by === 1 ? block.top + half : block.bottom - half),
          },
          false,
        );
        at = Math.min(line.to, Math.max(line.from, across));
        // Kept on, as CodeMirror's own Up and Down keep it, should the line
        // be short or blank.
        goal = x - view.contentDOM.getBoundingClientRect().left;
      }
      this.close();
      view.focus();
      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.cursor(at, 0, undefined, goal),
        ]),
        scrollIntoView: true,
      });
      return true;
    }
    /**
     * Adds an empty row after the table's last, then edits its cell in
     * `column`. Its indent is the delimiter row's, and it takes a pipe at
     * each edge, whatever the table's: GFM holds an empty cell between
     * pipes only.
     */
    addRow(column: number): void {
      const table = this.where()?.table;
      if (!table) return;
      const last = { row: tableRows(table).length - 2, column };
      const done = tableEdited(this.view.state, table, last, "addRowBelow");
      this.close();
      this.rewrite(table, done);
    }
    /** The cell edited, its place, and its table drawn and written. */
    where(): {
      editing: Editing;
      place: Place;
      frame: Element;
      table: SyntaxNode;
    } | null {
      const { editing, view } = this;
      const frame = editing?.host.closest(".cm-table");
      const place = editing && placeOf(editing.host);
      const table = frame && tableIn(view, frame);
      return editing && place && frame && table
        ? { editing, place, frame, table }
        : null;
    }
    /**
     * Writes `changes` to `table`, as one step for undo, apart from the
     * edits next to it, then edits the cell `to`, or should its row lack
     * it, the row's last.
     */
    rewrite(
      table: SyntaxNode,
      { changes, to }: { changes: ChangeSpec[]; to: Place },
    ): void {
      const { view } = this;
      const from = view.state.doc.lineAt(table.from).from;
      view.dispatch({ changes, annotations: isolateHistory.of("full") });
      const frame = frameAt(view, from);
      const node = frame && tableIn(view, frame);
      const row = frame?.querySelector("table")?.rows[to.row];
      if (!node || !row) return;
      let { column } = to;
      while (column > 0 && !cellText(view.state, node, { ...to, column })) {
        column -= 1;
      }
      const host = row.cells[column];
      if (!host) return;
      this.open(host);
      this.reveal();
    }
    /**
     * Opens the table's menu on a cell, edited first, where `event` asks
     * for it within the cell: whether it does. A cell its row lacks, or one
     * clicked while Find in note is open, shows its table as written
     * instead. From the keyboard, the point the browser gives may be
     * outside the cell. A press that asks for the menu as it starts, as on
     * a Mac, would close it as it ends, in WebKit: the menu waits for its
     * end.
     */
    menuAt(host: HTMLTableCellElement, event: MouseEvent): boolean {
      const menu = this.view.state.facet(tableMenu);
      if (!menu) return false;
      this.pressing?.abort();
      this.open(host);
      if (this.editing?.host !== host) return false;
      const { clientX: x, clientY: y } = event;
      const { left, right, top, bottom } = host.getBoundingClientRect();
      const within = x >= left && x <= right && y >= top && y <= bottom;
      // Unless the cell was left meanwhile.
      const shown = () => {
        if (this.editing?.host !== host) return;
        this.holding = true;
        menu.openAt(within ? x : left, within ? y : bottom);
      };
      if (event.buttons === 0) {
        shown();
        return true;
      }
      // Once the press ends, after the browser's own reaction to its end,
      // unless the system takes it over.
      const pressing = new AbortController();
      this.pressing = pressing;
      const options = { capture: true, signal: pressing.signal };
      addEventListener(
        "pointerup",
        () => {
          pressing.abort();
          setTimeout(shown);
        },
        options,
      );
      addEventListener(
        "pointercancel",
        () => {
          pressing.abort();
        },
        options,
      );
      return true;
    }
    /**
     * Makes `edit` from the table's menu to the cell edited, then edits the
     * cell it leaves edited, or gives the cell the focus back should it
     * change nothing: whether it applies.
     */
    edit(edit: TableEdit): boolean {
      const at = this.where();
      if (!at || !cellMenu(this.view.state, at).edits.has(edit)) return false;
      const { editing, place, table } = at;
      const done = tableEdited(this.view.state, table, place, edit);
      if (done.changes.length === 0) {
        editing.cell.focus();
        return true;
      }
      this.close();
      this.rewrite(table, done);
      return true;
    }
    /**
     * Once the table's menu has closed: the cell edited takes the focus
     * `back`, or closes where the focus went elsewhere.
     */
    released(back: boolean): void {
      this.holding = false;
      const { editing } = this;
      if (!editing || editing.cell.hasFocus) return;
      if (back) editing.cell.focus();
      else this.close();
    }
    /** Shows the table as written, the cursor where it was in the cell. */
    leave(): boolean {
      const { editing, view } = this;
      if (!editing) return false;
      const at = editing.from + editing.cell.state.selection.main.head;
      this.close();
      view.focus();
      view.dispatch({ selection: { anchor: at } });
      return true;
    }
    destroy() {
      this.close();
    }
  },
);

/**
 * The note's scroll margins, the widest on each side, as CodeMirror takes
 * them: the keyboard toolbar's and the app bar's, and its panels'.
 */
function margins(view: EditorView): Partial<Rect> {
  const all = view.state
    .facet(EditorView.scrollMargins)
    .map((marginOf) => marginOf(view) ?? {});
  const widest = (side: keyof Rect) =>
    Math.max(0, ...all.map((margin) => margin[side] ?? 0));
  return {
    top: widest("top"),
    bottom: widest("bottom"),
    left: widest("left"),
    right: widest("right"),
  };
}

// Where and when a finger pressed a table's cell, until it lifts.
let cellPressed: Press | null = null;

/**
 * A click on a table's cell, or a finger's tap, edits that cell, and a
 * right-click opens its menu too. A finger's tap does so as it lifts, its
 * end kept from the browser, which would place the cursor itself: in
 * WebKit, at the note's start. A finger that moves scrolls the table or
 * the page, and one that stays down as long as a long press is left to the
 * system.
 */
const editingTables = EditorView.domEventHandlers({
  mousedown(event, view) {
    const cell = tableCell(event.target);
    const modified =
      event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
    if (!cell || event.button !== 0 || modified) return false;
    event.preventDefault();
    view.plugin(editingCells)?.open(cell);
    return true;
  },
  contextmenu(event, view) {
    const cell = tableCell(event.target);
    if (!cell || pressedLong(event)) return false;
    const shown = view.plugin(editingCells)?.menuAt(cell, event) ?? false;
    if (shown) event.preventDefault();
    return shown;
  },
  touchstart(event) {
    const touch = event.changedTouches[0];
    cellPressed =
      tableCell(event.target) && event.touches.length === 1 && touch
        ? { x: touch.clientX, y: touch.clientY, at: Date.now() }
        : null;
    return false;
  },
  touchend(event, view) {
    const press = cellPressed;
    cellPressed = null;
    const cell = tableCell(event.target);
    if (!cell || !tapped(event, press)) return false;
    event.preventDefault();
    view.plugin(editingCells)?.open(cell);
    return true;
  },
});

/**
 * An arrow that would take the note's cursor from the line before or after
 * a table drawn into it, or across it, as CodeMirror's step over a widget,
 * edits a cell of it instead, as Obsidian does. A selection taken into a
 * table, as with Shift, takes its Markdown.
 */
function intoTable(by: 1 | -1, vertical: boolean): Command {
  return (view) => {
    const { main } = view.state.selection;
    const line = view.state.doc.lineAt(main.head);
    // Where a table drawn on the next line starts, or on the one before ends.
    const edge = by === 1 ? line.to + 1 : line.from - 1;
    const drawn = view.state.field(tables).iter(edge);
    if (
      !main.empty ||
      !drawn.value ||
      (by === 1 ? drawn.from : drawn.to) !== edge
    ) {
      return false;
    }
    // Up and Down from the row on screen next to the table, a wrapped line
    // having others; Left and Right from the line's edge.
    const to = vertical
      ? view.moveVertically(main, by === 1).head
      : main.head + by;
    return (
      (by === 1 ? to >= edge : to <= edge) &&
      (view.plugin(editingCells)?.arrive(drawn.from, by, vertical) ?? false)
    );
  };
}

const enteringTables = Prec.high(
  keymap.of([
    { key: "ArrowUp", run: intoTable(-1, true) },
    { key: "ArrowDown", run: intoTable(1, true) },
    { key: "ArrowLeft", run: intoTable(-1, false) },
    { key: "ArrowRight", run: intoTable(1, false) },
  ]),
);

const LOOK = EditorView.theme({
  // As the preview's.
  ".cm-task": {
    width: "18px",
    height: "18px",
    margin: "0",
    verticalAlign: "-3px",
    accentColor: "var(--primary)",
  },
  // The viewer's rule, across the line from what comes before it, such as
  // a quote's `>`, through the middle of its marks' line.
  ".cm-rule-line": { display: "flex" },
  ".cm-rule": {
    flex: "1",
    color: "transparent",
    background:
      "linear-gradient(var(--outline-variant), var(--outline-variant)) center / 100% 1px no-repeat",
  },
  // The viewer's quote, quieter: a 0.25em bar per level, then 1em before
  // its text, and 1em after it per level.
  ".cm-line.cm-quote": {
    paddingLeft: "calc(var(--text-inset) + var(--quote-depth) * 1.25em)",
    paddingRight: "calc(var(--text-inset) + var(--quote-depth) * 1em)",
    color: "var(--on-surface-variant)",
    backgroundImage:
      "repeating-linear-gradient(to right, var(--outline-variant) 0 0.25em, transparent 0.25em 1.25em)",
    backgroundPosition: "var(--text-inset) 0",
    backgroundSize: "calc(var(--quote-depth) * 1.25em) 100%",
    backgroundRepeat: "no-repeat",
  },
  ...Object.fromEntries(
    QUOTE_LINES.map((_, at) => [
      `.cm-quote-${String(at + 1)}`,
      { "--quote-depth": String(at + 1) },
    ]),
  ),
  // The viewer's table, as Drive lists files: a rule under each row, the
  // head quieter, as far in as the lines' text.
  ".cm-table": {
    overflowX: "auto",
    padding: "0 var(--text-inset)",
    // Its width the note's, however wide its table.
    contain: "inline-size",
  },
  ".cm-table table": { borderCollapse: "collapse", width: "max-content" },
  ".cm-table :is(th, td)": {
    padding: "var(--space-2) var(--space-5) var(--space-2) 0",
    borderBottom: "1px solid var(--outline-variant)",
    textAlign: "start",
  },
  ".cm-table th": {
    color: "var(--on-surface-variant)",
    fontSize: "0.875rem",
    fontWeight: "500",
    lineHeight: "1.25rem",
  },
  // A cell edited in place shows where the focus is on the cursor's line's
  // color, with a text field's active indicator under its text, which
  // starts at its edge, and its Markdown in the cell's own type.
  ".cm-table .cm-cell-edited": {
    backgroundColor: "var(--surface-container-low)",
    boxShadow: "inset 0 -2px 0 var(--primary)",
  },
  ".cm-table .cm-editor": { outline: "none" },
  ".cm-table .cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "visible",
  },
  ".cm-table .cm-content": { padding: "0" },
  ".cm-table .cm-line": { padding: "0" },
  // Safari zooms in on a field whose text is smaller.
  [`@media ${TOUCH}`]: {
    ".cm-table th .cm-editor": { fontSize: "max(16px, 1em)" },
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
  quoting,
  hasFocus,
  followingFocus,
  tables,
  editingTables,
  inCellField,
  editingCells,
  enteringTables,
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

/**
 * The lines the selection touches, each stretch of them from start to end,
 * with the whole of a table it touches, which shows as written.
 */
function linesWritten(state: EditorState): Stretch[] {
  return state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(tableAround(state, range.from)?.from ?? range.from)
      .from,
    to: state.doc.lineAt(tableAround(state, range.to)?.to ?? range.to).to,
  }));
}

/**
 * The table that `at` is in, if any: one left as written, in a quote, shows
 * all its marks too, so that its columns line up.
 */
function tableAround(state: EditorState, at: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 0);
  while (node && node.name !== "Table") node = node.parent;
  return node;
}

/**
 * Visual's symbols, hidden or drawn: emphasis' `*` and `_`,
 * strikethrough's `~~`, inline code's backticks, a heading's `#`, a link's
 * brackets and address, a list item's marker, a thematic break, and a
 * quote's `>`.
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
    case "QuoteMark":
      return quoteMark(state, node).map(hide);
    case "HorizontalRule":
      return [
        RULE_LINE.range(state.doc.lineAt(node.from).from),
        RULE.range(node.from, node.to),
      ];
    default:
      return [];
  }
}

/**
 * A quote's `>`, with the space or tab after it, which belongs to it, and
 * the indent before it, if it starts its line, when it is one of the first
 * marks on its line, as many as the quotes drawn around it, and the bars:
 * a mark is filed under the line's innermost block, maybe a quote in a
 * list, whatever quote it marks.
 */
function quoteMark(state: EditorState, node: SyntaxNodeRef): Stretch[] {
  let drawn = 0;
  for (let around = node.node.parent; around; around = around.parent) {
    if (around.name === "Blockquote" && drawnQuote(around)) drawn++;
  }
  const line = state.doc.lineAt(node.from);
  const before = state.sliceDoc(line.from, node.from);
  // Only container marks come before it on its line, the quotes' among them.
  const marks = before.split(">").length - 1;
  if (marks >= Math.min(drawn, QUOTE_LINES.length)) return [];
  const space = /[ \t]/.test(state.sliceDoc(node.to, node.to + 1));
  return [
    {
      from: before.trim() ? node.from : line.from,
      to: space ? node.to + 1 : node.to,
    },
  ];
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
