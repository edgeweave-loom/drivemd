import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** The editor in the app's colors, light or dark as the system is. */
export const THEME = EditorView.theme({
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

/**
 * A CodeMirror view in the element's shadow root. There, CodeMirror styles
 * itself through constructed style sheets, which the security policy allows,
 * where it would otherwise add <style> elements that the policy blocks.
 */
export function mountIn(element: HTMLElement, state: EditorState): EditorView {
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  return new EditorView({ parent: root, root, state });
}
