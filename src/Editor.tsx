import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  EditorState,
  RangeSetBuilder,
  type ChangeSpec,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import { linkAt } from "./source-links.ts";
import type { LineBreak } from "./text.ts";

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
  { tag: tags.monospace, fontFamily: "var(--monospace)" },
  { tag: tags.link, color: "var(--link)" },
  { tag: [tags.processingInstruction, tags.url], color: "var(--muted)" },
]);

/** The editor in the app's colors, light or dark as the system is. */
const THEME = EditorView.theme({
  "&": {
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    background: "var(--background)",
    color: "var(--text)",
    // Safari zooms in on a field whose text is smaller.
    fontSize: "max(16px, 1rem)",
  },
  "&.cm-focused": { outline: "2px solid var(--accent)" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { background: "color-mix(in srgb, var(--accent) 30%, transparent)" },
  ".cm-code-line": { fontFamily: "var(--monospace)" },
  ".cm-panels": {
    borderColor: "var(--border)",
    background: "var(--surface)",
    color: "inherit",
  },
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
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
      const at = view.posAtCoords(event);
      const href = at === null ? undefined : linkAt(view.state, at);
      if (href === undefined) return false;
      event.preventDefault();
      follow(href);
      return true;
    },
  });
}

function extensions(
  lineBreak: LineBreak,
  changed: (update: ViewUpdate) => void,
  follow: (href: string) => void,
): Extension[] {
  return [
    // Lines join with the file's own break, whatever the browser sends.
    EditorState.lineSeparator.of(lineBreak),
    writable(lineBreak),
    history(),
    // GitHub's Markdown, its fences highlighted in their language; Enter
    // continues lists and task lists.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(LIGHT),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    codeBlocks,
    THEME,
    // The browser's own find misses lines the editor has not drawn.
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
    EditorView.updateListener.of(changed),
    followLinks(follow),
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
 * line breaks.
 */
export function Editor({
  initial,
  lineBreak,
  onChange,
  onFollow,
  ref,
}: {
  initial: string;
  lineBreak: LineBreak;
  onChange: (text: string) => void;
  /** Follows a link the user Cmd or Ctrl+clicks. */
  onFollow: (href: string) => void;
  ref?: Ref<EditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const opening = useEffectEvent(() => initial);
  const edited = useEffectEvent((update: ViewUpdate) => {
    if (update.docChanged) onChange(update.state.sliceDoc());
  });
  const followed = useEffectEvent((href: string) => {
    onFollow(href);
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // In a shadow root, CodeMirror styles itself through constructed style
    // sheets, which the security policy allows, where it would otherwise add
    // <style> elements that the policy blocks.
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const view = new EditorView({
      parent: root,
      root,
      state: EditorState.create({
        doc: opening(),
        extensions: extensions(lineBreak, edited, followed),
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, [lineBreak]);

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

  return <div className="editor" ref={host} />;
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
