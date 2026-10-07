import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const DARK = "(prefers-color-scheme: dark)";

const turnDark = StateEffect.define<boolean>();

// Whether the system's theme is dark, which CodeMirror cannot tell from
// the app's colors: its packages, such as @codemirror/merge, otherwise style
// themselves for a light theme.
const systemDark = StateField.define<boolean>({
  create: () => window.matchMedia(DARK).matches,
  update: (dark, transaction) =>
    transaction.effects.reduce(
      (value, effect) => (effect.is(turnDark) ? effect.value : value),
      dark,
    ),
  provide: (field) => EditorView.darkTheme.from(field),
});

const followSystem = ViewPlugin.define((view) => {
  const query = window.matchMedia(DARK);
  const follow = () => {
    view.dispatch({ effects: turnDark.of(query.matches) });
  };
  query.addEventListener("change", follow);
  return {
    destroy: () => {
      query.removeEventListener("change", follow);
    },
  };
});

// CodeMirror measures its lines again once the fonts loading as it starts
// are in, but not for a font that loads later, as one does when the text
// first shows letters of its script or code: lines may then wrap anew.
const measureOnFonts = ViewPlugin.define((view) => {
  const measure = () => {
    view.requestMeasure();
  };
  document.fonts.addEventListener("loadingdone", measure);
  return {
    destroy: () => {
      document.fonts.removeEventListener("loadingdone", measure);
    },
  };
});

const COLORS = EditorView.theme({
  "&": {
    border: "1px solid var(--outline-variant)",
    borderRadius: "0.5rem",
    background: "var(--surface)",
    color: "var(--on-surface)",
    // Safari zooms in on a field whose text is smaller.
    fontSize: "max(16px, 1rem)",
  },
  "&.cm-focused": { outline: "2px solid var(--primary)" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--on-surface)" },
  ".cm-cursor": { borderLeftColor: "var(--on-surface)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { background: "color-mix(in srgb, var(--primary) 30%, transparent)" },
  ".cm-code-line": { fontFamily: "var(--font-mono)" },
  ".cm-panels": {
    borderColor: "var(--outline-variant)",
    background: "var(--surface-container)",
    color: "inherit",
  },
  // The differences: what the user's version adds underlined, and what it
  // removes struck through, never told by color alone, its lines on colors
  // of their own. The selectors match @codemirror/merge's own, which they
  // replace.
  "&.cm-merge-b .cm-changedLine": {
    background: "var(--diff-added)",
    color: "var(--on-tertiary-container)",
  },
  "&.cm-merge-b .cm-changedText": {
    background: "none",
    textDecoration: "underline",
  },
  ".cm-deletedChunk": {
    background: "var(--diff-removed)",
    color: "var(--on-error-container)",
  },
  "&.cm-merge-b .cm-deletedText, .cm-deletedChunk .cm-deletedText": {
    background: "none",
    textDecoration: "line-through",
  },
  ".cm-collapsedLines": {
    background: "var(--surface-container)",
    color: "var(--on-surface-variant)",
  },
});

/**
 * The editor in the app's colors, light or dark as the system is, and in
 * its fonts.
 */
export const THEME: Extension = [
  COLORS,
  systemDark,
  followSystem,
  measureOnFonts,
];

/**
 * A CodeMirror view in the element's shadow root. There, CodeMirror styles
 * itself through constructed style sheets, which the security policy allows,
 * where it would otherwise add <style> elements that the policy blocks.
 */
export function mountIn(element: HTMLElement, state: EditorState): EditorView {
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  return new EditorView({ parent: root, root, state });
}
