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
  useState,
  type Ref,
} from "react";
import { mountIn, THEME } from "./codemirror.ts";
import { withFrontmatter } from "./frontmatter.ts";
import { KeyboardToolbar, TOOLBAR_HEIGHT } from "./KeyboardToolbar.tsx";
import { commandKey } from "./keys.ts";
import { useTouch } from "./layout.ts";
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

/**
 * YAML, in front matter and code blocks, in the same light way: its keys,
 * symbols and comments dimmed, its values as text.
 */
const LIGHT_YAML = HighlightStyle.define(
  [
    {
      tag: [tags.propertyName, tags.punctuation, tags.comment],
      color: "var(--muted)",
    },
  ],
  { scope: yamlLanguage },
);

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

function extensions(
  lineBreak: LineBreak,
  changed: (update: ViewUpdate) => void,
  follow: (href: string) => void,
  clearance: () => { bottom: number } | null,
): Extension[] {
  return [
    // Lines join with the file's own break, whatever the browser sends.
    EditorState.lineSeparator.of(lineBreak),
    writable(lineBreak),
    history(),
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
    // The browser's own find misses lines the editor has not drawn.
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
    EditorView.updateListener.of(changed),
    followLinks(follow),
    // The cursor stays clear of the keyboard toolbar when the editor
    // scrolls to it.
    EditorView.scrollMargins.of(clearance),
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
  const [focused, setFocused] = useState(false);
  const toolbar = useTouch() && focused;
  const opening = useEffectEvent(() => initial);
  const edited = useEffectEvent((update: ViewUpdate) => {
    if (update.docChanged) onChange(update.state.sliceDoc());
    if (update.focusChanged) setFocused(update.view.hasFocus);
  });
  const clearance = useEffectEvent(() =>
    toolbar ? { bottom: TOOLBAR_HEIGHT } : null,
  );
  const followed = useEffectEvent((href: string) => {
    onFollow(href);
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const view = mountIn(
      element,
      EditorState.create({
        doc: opening(),
        extensions: extensions(lineBreak, edited, followed, clearance),
      }),
    );
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

  return (
    <>
      <div className="editor" ref={host} />
      {toolbar && (
        <KeyboardToolbar
          onCommand={(command) => {
            if (editor.current) command(editor.current);
          }}
        />
      )}
    </>
  );
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
