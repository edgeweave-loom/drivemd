import { isolateHistory } from "@codemirror/commands";
import { highlightingFor, syntaxTree } from "@codemirror/language";
import { searchPanelOpen } from "@codemirror/search";
import {
  EditorState,
  StateEffect,
  StateField,
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
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";

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

/**
 * A table, drawn as the viewer draws it, which a tap or a click on a cell
 * shows as written, the cursor in that cell's Markdown.
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
    this.rows.forEach((cells, at) => {
      const row = (at === 0 ? head : body).insertRow();
      for (let column = 0; column < columns; column++) {
        const cell = document.createElement(at === 0 ? "th" : "td");
        const alignment = this.alignments[column];
        if (alignment) cell.style.textAlign = alignment;
        for (const { text, style } of cells[column] ?? []) {
          if (style === null) {
            cell.append(text);
          } else {
            const span = document.createElement("span");
            span.className = style;
            span.textContent = text;
            cell.append(span);
          }
        }
        row.append(cell);
      }
    });
    frame.append(table);
    return frame;
  }
  override get estimatedHeight(): number {
    return this.rows.length * 42;
  }
  // The editor takes its cells' taps and clicks, which show the table as
  // written, and leaves the browser the rest, such as its scroll bar's.
  override ignoreEvent(event: Event): boolean {
    return tableCell(event.target) === null;
  }
}

const focused = StateEffect.define<boolean>();

// Whether the editor has the focus, which a state field cannot ask the view.
const hasFocus = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) =>
    transaction.effects.reduce(
      (has, effect) => (effect.is(focused) ? effect.value : has),
      value,
    ),
});

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

/**
 * Shows the cell's table as written, the cursor at the end of the cell's
 * text and the focus in the editor, the cell's row staying where it was
 * on the screen, as far as the page scrolls.
 */
function editCell(view: EditorView, cell: HTMLTableCellElement): void {
  const frame = cell.closest(".cm-table");
  const row = cell.parentElement;
  if (!frame || !(row instanceof HTMLTableRowElement)) return;
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
    view.posAtDOM(frame),
    1,
  );
  while (node && node.name !== "Table") node = node.parent;
  if (!node) return;
  // The head's row is the table's first line, and the body's follow the
  // delimiter row.
  const line = tableRows(node)[row.rowIndex === 0 ? 0 : row.rowIndex + 1];
  if (!line) return;
  const stretch = cellsOf(view.state, line)[cell.cellIndex];
  const head = stretch ? trimmed(view.state, stretch).to : line.to;
  const top = row.getBoundingClientRect().top + window.scrollY;
  // Focused at once, so that the table shows as written as the cursor
  // moves, and the row is measured as it is then.
  view.focus();
  view.dispatch({ selection: { anchor: head }, effects: focused.of(true) });
  view.requestMeasure({
    read: () => pageTop(view, head) - top,
    write: (shift) => {
      if (Math.abs(shift) >= 1) window.scrollBy(0, shift);
    },
  });
}

// Where and when a finger pressed a table's cell, until it lifts.
let cellPressed: Press | null = null;

/**
 * A click on a table's cell, or a finger's tap, shows the table as
 * written, the cursor in that cell. A finger's tap does so as it lifts,
 * its end kept from the browser, which would place the cursor itself: in
 * WebKit, at the note's start. A finger that moves scrolls the table or
 * the page, and one that stays down as long as a long press is left to
 * the system.
 */
const editingTables = EditorView.domEventHandlers({
  mousedown(event, view) {
    const cell = tableCell(event.target);
    const modified =
      event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
    if (!cell || event.button !== 0 || modified) return false;
    event.preventDefault();
    editCell(view, cell);
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
    editCell(view, cell);
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
  hasFocus,
  followingFocus,
  tables,
  editingTables,
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

/** The table drawn in Visual that `at` is in, if any. */
function tableAround(state: EditorState, at: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 0);
  while (node && node.name !== "Table") node = node.parent;
  return node && drawable(node) ? node : null;
}

/**
 * Whether Visual draws a table: at the note's top, not in a quote or a
 * list, whose lines start with their marks.
 */
function drawable(table: SyntaxNode): boolean {
  const parent = table.parent;
  return parent?.name === "Document";
}

/**
 * Visual's symbols, hidden or drawn: emphasis' `*` and `_`,
 * strikethrough's `~~`, inline code's backticks, a heading's `#`, a link's
 * brackets and address, a list item's marker, and a thematic break.
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
    case "HorizontalRule":
      return [
        RULE_LINE.range(state.doc.lineAt(node.from).from),
        RULE.range(node.from, node.to),
      ];
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
