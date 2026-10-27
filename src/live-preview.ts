import {
  defaultKeymap,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { highlightingFor, syntaxTree } from "@codemirror/language";
import { searchPanelOpen } from "@codemirror/search";
import {
  Annotation,
  EditorState,
  Facet,
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

/** A part of a cell's text, drawn in the editor's highlighting. */
interface Part {
  text: string;
  style: string | null;
}

type Alignment = "left" | "right" | "center" | null;

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
      ...(this.rows[row]?.[column] ?? []).map(({ text, style }) => {
        if (style === null) return text;
        const span = document.createElement("span");
        span.className = style;
        span.textContent = text;
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
        if (!cell.querySelector(".cm-editor") && !same(at, column)) {
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
  const pipes = row.getChildren("TableDelimiter");
  const cells: Stretch[] = [];
  let from = row.from;
  for (const pipe of pipes) {
    cells.push({ from, to: pipe.from });
    from = pipe.to;
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

/**
 * A cell's text in the editor's highlighting, its symbols hidden as Visual
 * hides them, and an escape's backslash too, as the viewer does, so that
 * an escaped pipe shows in its cell.
 */
function parts(state: EditorState, { from, to }: Stretch): Part[] {
  const hidden: Stretch[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "Escape") {
        hidden.push({ from: node.from, to: node.from + 1 });
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
    if (hidden.some((range) => range.from <= start && range.to >= end)) return;
    const style =
      styled.find((range) => range.from <= start && range.to >= end)?.style ??
      null;
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

/** The table drawn in `frame`, in the note's syntax tree. */
function tableIn(view: EditorView, frame: Element): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
    view.posAtDOM(frame),
    1,
  );
  while (node && node.name !== "Table") node = node.parent;
  return node;
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

/**
 * The changes that keep a cell's text in its cell, as GFM and Lezer read a
 * row, counting backslashes: a line break, which would end the row, turns
 * into the viewer's `<br>`; a pipe after an even run of backslashes, which
 * would end the cell, is escaped; and an odd run at the text's end, which
 * would escape the pipe `after` it, takes a space.
 */
function keptInCell(text: string, after: string): ChangeSpec[] {
  const fixes: ChangeSpec[] = [];
  let escaped = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\n") fixes.push({ from: at, to: at + 1, insert: "<br>" });
    else if (char === "|" && !escaped) fixes.push({ from: at, insert: "\\" });
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

/**
 * Edits a table's cells in place, as Obsidian does: a cell tapped or
 * clicked takes an editor of its own, which shows its Markdown, the table
 * drawn around it. Its edits are the note's, which holds the text and its
 * history, so that undo takes them back as any other: a cell's editor
 * holds its cell's text alone, which can thus never take or break a row.
 * Tab moves to the next cell, Shift+Tab to the one before, Enter to the
 * one below, and Escape shows the table as written.
 */
const editingCells = ViewPlugin.fromClass(
  class {
    editing: Editing | null = null;
    readonly view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
    }
    /**
     * Edits a cell drawn, the cursor at its text's end, or the one edited
     * where its cursor is. While Find in note is open, as for a cell its
     * row lacks, shows its table as written, the cursor at the cell's end,
     * or at the row's: a table shows so where Find in note's selection is.
     */
    open(host: HTMLTableCellElement): void {
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
      host.replaceChildren();
      host.classList.add("cm-cell-edited");
      const cell: EditorView = new EditorView({
        parent: host,
        root: view.root instanceof ShadowRoot ? view.root : document,
        state: EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: this.setup(),
        }),
        dispatchTransactions: (transactions) => {
          this.pass(cell, transactions);
        },
      });
      this.editing = { cell, host, ...text };
      cell.focus();
      view.dispatch({
        selection: { anchor: text.to },
        effects: [focused.of(false), cellFocused.of(true)],
      });
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
          { key: "Tab", run: () => this.step(1), shift: () => this.step(-1) },
          { key: "Enter", run: () => this.down() },
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
              if (this.editing?.cell === cell && !cell.hasFocus) this.close();
            });
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
      // Never within an update of the note's, nor once another cell is
      // edited, as from Tab.
      queueMicrotask(() => {
        if (!this.editing && view.plugin(editingCells) && inCell(view.state)) {
          view.dispatch({ effects: cellFocused.of(false) });
        }
      });
    }
    /** Edits the next cell of the table, or the one before, if any. */
    step(by: 1 | -1): boolean {
      return this.go((place, columns) => {
        const at = place.row * columns + place.column + by;
        return { row: Math.floor(at / columns), column: at % columns };
      });
    }
    /** Edits the cell below, if any. */
    down(): boolean {
      return this.go((place) => ({ ...place, row: place.row + 1 }));
    }
    /**
     * Edits the first cell the table's rows hold that `next` takes the
     * cell edited to, from cell to cell; the key is taken either way.
     */
    go(next: (place: Place, columns: number) => Place): boolean {
      const { editing, view } = this;
      const frame = editing?.host.closest(".cm-table");
      const table = frame?.querySelector("table");
      let place = editing && placeOf(editing.host);
      const node = frame && tableIn(view, frame);
      if (!table || !place || !node) return true;
      const columns = table.rows[0]?.cells.length ?? 1;
      for (;;) {
        place = next(place, columns);
        const host = table.rows[place.row]?.cells[place.column];
        if (!host || place.row < 0 || place.column < 0) return true;
        if (cellText(view.state, node, place)) {
          this.open(host);
          return true;
        }
      }
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
 * A click on a table's cell, or a finger's tap, edits that cell. A
 * finger's tap does so as it lifts, its end kept from the browser, which
 * would place the cursor itself: in WebKit, at the note's start. A finger
 * that moves scrolls the table or the page, and one that stays down as
 * long as a long press is left to the system.
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
