import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlLanguage } from "@codemirror/lang-yaml";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  getSearchQuery,
  highlightSelectionMatches,
  search,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
  type SearchQuery,
} from "@codemirror/search";
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  type ChangeSpec,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { mountIn, THEME } from "./codemirror.ts";
import { keepDoubleSpace } from "./double-space.ts";
import { countMatches, findInNote, findsInNote, type Matches } from "./find.ts";
import { FindBar } from "./FindBar.tsx";
import { indentLines, outdentLines } from "./formatting.ts";
import { withFrontmatter } from "./frontmatter.ts";
import { KeyboardToolbar, TOOLBAR_HEIGHT } from "./KeyboardToolbar.tsx";
import { InSlot } from "./InSlot.tsx";
import { commandKey } from "./keys.ts";
import { useLayout, useTouch } from "./layout.ts";
import {
  cellEditor,
  cellSetup,
  inCell,
  inVault,
  livePreview,
  tableMenu,
  tableMenuOf,
  type CellMenu,
  type TableMenuControl,
} from "./live-preview.ts";
import { oneEditPerKey } from "./one-edit-per-key.ts";
import { linkAt } from "./source-links.ts";
import { TableMenu } from "./TableMenu.tsx";
import type { LineBreak } from "./text.ts";
import { keepVisible } from "./visual-viewport.ts";

/**
 * Light live styling: headings larger, bold and italic as such, code in
 * monospace, and Markdown's own symbols dimmed but never hidden, so that the
 * cursor and selection behave as in plain text.
 */
const LIGHT = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold" },
  { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold" },
  {
    tag: [tags.heading4, tags.heading5, tags.heading6],
    fontWeight: "bold",
  },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: tags.link, color: "var(--primary)" },
  { tag: tags.url, color: "var(--on-surface-variant)" },
  // A heading's or bold text's marks take its tag too: they stay at the
  // text's size and weight.
  {
    tag: tags.processingInstruction,
    color: "var(--on-surface-variant)",
    fontSize: "1em",
    fontWeight: "normal",
  },
]);

/**
 * YAML, in front matter and code blocks, in the same light way: its keys,
 * symbols and comments dimmed, its values as text.
 */
const LIGHT_YAML = HighlightStyle.define(
  [
    {
      tag: [tags.propertyName, tags.punctuation, tags.comment],
      color: "var(--on-surface-variant)",
    },
  ],
  { scope: yamlLanguage },
);

/**
 * The source on its sheet, or on a phone's page, without a frame of its
 * own: its lines run from edge to edge, their text as far in as the text
 * beside it, and the cursor's line shows where the focus is, as in Docs,
 * marked at its start in the focus ring's color, which stands out from
 * any surface where the line's own color does not.
 */
const ON_SHEET = EditorView.theme({
  // The editor's layers stack among themselves, all under the app bar and
  // Find in note's bar.
  "&": { isolation: "isolate" },
  "&.cm-focused": { outline: "none" },
  // 26 px lines at 16 px, as the note's own.
  ".cm-scroller": { lineHeight: "1.625" },
  ".cm-line": { padding: "0 var(--text-inset)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused .cm-activeLine": {
    backgroundColor: "var(--surface-container-low)",
    boxShadow: "inset 2px 0 0 var(--primary)",
  },
  // Find in note's bar is the page's own (FindBar.tsx): CodeMirror's panel
  // only holds that the search is open, which shows its matches.
  ".cm-panels": { display: "none" },
});

const CODE_LINE = Decoration.line({ class: "cm-code-line" });

/** Code blocks in monospace, line by line, where the screen shows them. */
const codeBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = codeLines(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = codeLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function codeLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  // A block can span two visible ranges: each line is marked once.
  let next = 0;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        for (let at = Math.max(node.from, next); at <= node.to;) {
          const line = doc.lineAt(at);
          builder.add(line.from, line.from, CODE_LINE);
          at = next = line.to + 1;
        }
        return false;
      },
    });
  }
  return builder.finish();
}

// Half of a character that takes two UTF-16 units, without its other half.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Keeps what an edit inserts writable as shown, however it comes: pasted,
 * dropped, typed by an input method, or put by a replacement. A line break
 * of another kind than the file's would stay inside its line as a character,
 * and the file would no longer have one kind of line break; a NUL would make
 * it read as UTF-16; and half a character would be written as another.
 */
function writable(lineBreak: LineBreak): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    const fixes: ChangeSpec[] = [];
    transaction.changes.iterChanges((_fromA, _toA, from, to) => {
      const written = transaction.newDoc.sliceString(from, to, lineBreak);
      const fixed = written
        .replace(/\r\n|\r|\n/g, lineBreak)
        .replaceAll("\0", "")
        .replace(LONE_SURROGATE, "\uFFFD");
      if (fixed !== written) fixes.push({ from, to, insert: fixed });
    }, true);
    return fixes.length === 0
      ? transaction
      : [transaction, { changes: fixes, sequential: true }];
  });
}

/**
 * Cmd or Ctrl+click on a link follows it, as in Obsidian; any other click
 * places the cursor. CodeMirror would add a cursor there instead.
 */
function followLinks(follow: (href: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !commandKey(event)) return false;
      const at = view.posAtCoords(event);
      const href = at === null ? undefined : linkAt(view.state, at);
      if (href === undefined) return false;
      event.preventDefault();
      follow(href);
      return true;
    },
  });
}

// Markdown's blocks, which a table's cell cannot hold: its text is inline.
const BLOCKS = [
  "ATXHeading",
  "Blockquote",
  "BulletList",
  "FencedCode",
  "HTMLBlock",
  "HorizontalRule",
  "IndentedCode",
  "LinkReference",
  "OrderedList",
  "SetextHeading",
  "Table",
];

// Visual or Source, which the editor switches between as it stays.
const MODE = new Compartment();

function inMode(visual: boolean, vault: boolean): Extension {
  return visual
    ? [
        livePreview,
        inVault.of(vault),
        // A table's cell edited in place, in the source's light styling.
        cellSetup.of([
          markdown({ base: markdownLanguage, extensions: { remove: BLOCKS } }),
          syntaxHighlighting(LIGHT),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          oneEditPerKey,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Note" }),
      ]
    : EditorView.contentAttributes.of({ "aria-label": "Markdown source" });
}

function extensions(
  lineBreak: LineBreak,
  mode: Extension,
  changed: (update: ViewUpdate) => void,
  follow: (href: string) => void,
  clearance: () => { top: number; bottom: number } | null,
  menu: TableMenuControl,
): Extension[] {
  return [
    // Lines join with the file's own break, whatever the browser sends.
    EditorState.lineSeparator.of(lineBreak),
    writable(lineBreak),
    history(),
    keepDoubleSpace,
    oneEditPerKey,
    // GitHub's Markdown, its fences highlighted in their language and its
    // front matter in YAML; Enter continues lists and task lists.
    withFrontmatter(
      markdown({ base: markdownLanguage, codeLanguages: languages }),
    ),
    syntaxHighlighting(LIGHT),
    syntaxHighlighting(LIGHT_YAML),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    codeBlocks,
    THEME,
    ON_SHEET,
    highlightActiveLine(),
    // The browser's own find misses lines the editor has not drawn.
    // At the top, where its hidden panel takes no room from the cursor's.
    search({
      createPanel: () => ({ dom: document.createElement("div"), top: true }),
    }),
    highlightSelectionMatches(),
    keymap.of([
      // A list item nests from the keyboard as from the toolbar's keys.
      { key: "Mod-]", run: indentLines },
      { key: "Mod-[", run: outdentLines },
      ...defaultKeymap,
      ...historyKeymap,
      // Its field is the page's, where CodeMirror's own Mod-f misses it.
      { key: "Mod-f", run: findInNote, scope: "editor search-panel" },
      ...searchKeymap,
    ]),
    EditorView.lineWrapping,
    MODE.of(mode),
    EditorView.updateListener.of(changed),
    followLinks(follow),
    // A right-click on a table's cell in Visual opens its menu.
    tableMenu.of(menu),
    // The cursor stays clear of the keyboard toolbar and the app bar when
    // the editor scrolls to it.
    EditorView.scrollMargins.of(clearance),
    // A tap places the cursor without scrolling to it, where the toolbar
    // may cover it.
    EditorState.transactionExtender.of((transaction) =>
      transaction.selection &&
      transaction.isUserEvent("select") &&
      !transaction.scrollIntoView &&
      clearance()
        ? { effects: EditorView.scrollIntoView(transaction.newSelection.main) }
        : null,
    ),
  ];
}

/** What the page may ask of the editor. */
export interface EditorHandle {
  /**
   * Turns the text `from` into `to` as one edit, as when a task is tapped in
   * the preview, if the editor still holds `from`: typing may have moved on
   * since the preview showed it.
   */
  offer: (from: string, to: string) => void;
}

/**
 * The note's Markdown source, in CodeMirror, which holds the text while it
 * shows: it starts from `initial` and reports every edit, keeping the file's
 * line breaks. In Visual, the note reads as it renders, its Markdown shown
 * only where it is being written.
 */
export function Editor({
  initial,
  lineBreak,
  visual = false,
  vault = false,
  onChange,
  onFollow,
  ref,
}: {
  initial: string;
  lineBreak: LineBreak;
  visual?: boolean;
  /** Whether the note is in an Obsidian vault, whose syntax Visual draws. */
  vault?: boolean;
  onChange: (text: string) => void;
  /** Follows a link the user Cmd or Ctrl+clicks, or opens from the toolbar. */
  onFollow: (href: string) => void;
  ref?: Ref<EditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // The table's cell edited in place that has the focus, if any: the edits
  // that apply to it, and its column's alignment, which the toolbar shows.
  const [cell, setCell] = useState<CellMenu | null>(null);
  // The address of the link the cursor is in, which the toolbar follows.
  const [link, setLink] = useState<string>();
  // Find in note's query and matches, while it is open.
  const [found, setFound] = useState<Found | null>(null);
  const searching = found !== null;
  const touch = useTouch();
  const phone = useLayout() === "phone";
  const toolbar = touch && focused;
  const opening = useEffectEvent(() => ({
    initial,
    mode: inMode(visual, vault),
  }));
  const edited = useEffectEvent((update: ViewUpdate) => {
    if (update.docChanged) onChange(update.state.sliceDoc());
    // A table's cell edited in place has the focus for the note.
    const celled = inCell(update.state);
    if (update.focusChanged || celled !== inCell(update.startState)) {
      setFocused(update.view.hasFocus || celled);
    }
    // Anew as the cell, its table or its column's alignment change.
    if (celled || inCell(update.startState)) {
      const now = tableMenuOf(update.view);
      setCell((was) => (cellKey(was) === cellKey(now) ? was : now));
    }
    if (update.docChanged || update.selectionSet) {
      setLink(linkAt(update.state, update.state.selection.main.head));
    }
    if (!searchPanelOpen(update.state)) {
      if (searchPanelOpen(update.startState)) setFound(null);
      return;
    }
    const asked = update.transactions.some(findsInNote);
    if (
      asked ||
      update.docChanged ||
      update.selectionSet ||
      getSearchQuery(update.state) !== getSearchQuery(update.startState)
    ) {
      const next = finding(update.state);
      if (!asked) {
        setFound(next);
        return;
      }
      // At once, so that the field takes the focus within the tap, which
      // alone brings up a phone's keyboard.
      flushSync(() => {
        setFound(next);
      });
      field.current?.focus();
      field.current?.select();
    }
  });
  // While the toolbar or Find in note shows, the app bar stays on the
  // screen, Done and Save with it, and on a wider screen than a phone's,
  // Find in note's bar under it: iOS pans the visual viewport away from the
  // page's top, where they stick.
  const keeping = touch && (focused || searching);
  useLayoutEffect(() => {
    if (!keeping) return;
    const appBar = document.querySelector<HTMLElement>(".bar");
    const findBar =
      searching && !phone
        ? document.querySelector<HTMLElement>(".find-bar")
        : null;
    const stops = [
      appBar && keepVisible(appBar),
      findBar && keepVisible(findBar, { below: appBar }),
    ];
    return () => {
      for (const stop of stops) stop?.();
    };
  }, [keeping, searching, phone]);
  // The cursor and the matches stay clear of the bars over the page's top,
  // and of the toolbar.
  const clearance = useEffectEvent(() =>
    toolbar || searching
      ? {
          top: Math.max(
            0,
            ...[".bar", ".find-bar"].map(
              (bar) =>
                document.querySelector(bar)?.getBoundingClientRect().bottom ??
                0,
            ),
          ),
          bottom: toolbar ? belowToolbar() : 0,
        }
      : null,
  );
  const followed = useEffectEvent((href: string) => {
    onFollow(href);
  });
  const menuId = useId();
  const menu = useRef<TableMenuControl>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const { initial, mode } = opening();
    const view = mountIn(
      element,
      EditorState.create({
        doc: initial,
        extensions: extensions(lineBreak, mode, edited, followed, clearance, {
          openAt: (x, y) => {
            menu.current?.openAt(x, y);
          },
          close: () => {
            menu.current?.close();
          },
        }),
      }),
    );
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, [lineBreak]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: MODE.reconfigure(inMode(visual, vault)),
    });
  }, [visual, vault]);

  useImperativeHandle(
    ref,
    () => ({
      offer(from, to) {
        const view = editor.current;
        if (view?.state.sliceDoc() !== from) return;
        view.dispatch({ changes: change(view.state, to, lineBreak) });
      },
    }),
    [lineBreak],
  );

  // Leaving Find in note gives the focus back to the text, at the match
  // last found, which iOS may have panned under the keyboard, clear of the
  // toolbar that the focus brings back on a touch screen.
  const searched = (view: EditorView) => {
    if (searchPanelOpen(view.state)) return;
    view.focus();
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main, {
        yMargin: touch ? TOOLBAR_HEIGHT : 5,
      }),
    });
  };
  const bar = found && (
    <FindBar
      query={found.query}
      matches={found.matches}
      field={field}
      onQuery={(query) => {
        editor.current?.dispatch({ effects: setSearchQuery.of(query) });
      }}
      onCommand={(command: Command) => {
        const view = editor.current;
        if (!view) return;
        command(view);
        searched(view);
      }}
      onKey={(event) => {
        const view = editor.current;
        if (!view) return false;
        const handled = runScopeHandlers(view, event, "search-panel");
        searched(view);
        return handled;
      }}
    />
  );

  return (
    <>
      {phone ? <InSlot name="find">{bar}</InSlot> : bar}
      <div className="editor" ref={host} />
      <TableMenu id={menuId} editor={editor} ref={menu} />
      {toolbar && (
        <KeyboardToolbar
          link={link}
          cell={cell}
          tableMenu={menuId}
          // A cell edited in place follows what the keys do to its text.
          onCommand={(command) => {
            if (editor.current) command(editor.current);
          }}
          onFollow={onFollow}
          // Once the keyboard has come or gone, and as the toolbar first
          // shows: the tap that gave the editor the focus, or Find in note's
          // close, placed the cursor before it showed, where iOS scrolls it
          // above the keyboard only, under the toolbar.
          onSettle={(before) => {
            const note = editor.current;
            // In a table's cell edited in place, the cell's own cursor.
            const view = note && (cellEditor(note) ?? note);
            if (view && onScreen(view, before)) {
              view.dispatch({
                effects: EditorView.scrollIntoView(view.state.selection.main),
              });
            }
          }}
        />
      )}
    </>
  );
}

/** A cell's edits and alignment, to compare. */
function cellKey(cell: CellMenu | null): string {
  return cell ? [cell.alignment, ...cell.edits].join() : "";
}

interface Found {
  query: SearchQuery;
  matches: Matches;
}

function finding(state: EditorState): Found {
  const query = getSearchQuery(state);
  return { query, matches: countMatches(state, query) };
}

/**
 * Whether the cursor shows in the visual viewport, perhaps under the
 * keyboard toolbar, or showed in it at its height `before`, rather than
 * where the user scrolled away from it: Safari resizes the visual viewport
 * as its bars fold while the page scrolls, not only as the keyboard comes
 * or goes. Chrome on Android scrolls neither to the cursor that a tap
 * brings the keyboard up over, which then hides it.
 */
function onScreen(view: EditorView, before: number): boolean {
  const cursor = view.coordsAtPos(view.state.selection.main.head);
  const viewport = window.visualViewport;
  if (!cursor || !viewport) return false;
  const top = viewport.pageTop - window.scrollY;
  return (
    cursor.bottom > top && cursor.top < top + Math.max(before, viewport.height)
  );
}

/**
 * How far the keyboard toolbar's top sits above the visual viewport's
 * height, which CodeMirror takes for the window's bottom, measuring from the
 * page's top: the visual viewport may sit lower, where a keyboard covers the
 * page without shrinking it. Before the toolbar shows, its height.
 */
function belowToolbar(): number {
  const viewport = window.visualViewport;
  const bar = document.querySelector(".keyboard-toolbar");
  if (!viewport || !bar) return TOOLBAR_HEIGHT;
  return Math.round(viewport.height - bar.getBoundingClientRect().top);
}

/**
 * The one change that turns the editor's text into `text`: the stretch
 * between what they share at the start and at the end. Positions count each
 * line break as one, whatever the file's.
 */
function change(state: EditorState, text: string, lineBreak: LineBreak) {
  const before = state.doc.toString();
  const after = text.replaceAll(lineBreak, "\n");
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    from: start,
    to: before.length - end,
    insert: state.toText(
      after.slice(start, after.length - end).replaceAll("\n", lineBreak),
    ),
  };
}
