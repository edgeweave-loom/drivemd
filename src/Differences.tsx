import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useEffectEvent, useRef } from "react";
import { mountIn, THEME } from "./codemirror.ts";

// In code type on a sheet (docs/DESIGN.md, Differences), the runs alike
// folded into a line that says how many. Before THEME, which would win.
const FRAME = EditorView.theme({
  "&": {
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    background: "var(--sheet)",
    fontSize: "14px",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "22px" },
  ".cm-line, .cm-deletedChunk > .cm-deletedLine": {
    padding: "0 var(--space-3)",
  },
  ".cm-deletedChunk": { paddingLeft: "0" },
  ".cm-collapsedLines": {
    padding: "0 var(--space-3)",
    textAlign: "center",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    "&::before, &::after": { content: "none" },
  },
});

/**
 * The user's version against Google Drive's, in one view that reads the
 * same on a phone: what the user's version removes shows struck through in
 * place, and what it adds underlined. Long stretches alike fold away.
 */
export function Differences({
  theirs,
  mine,
}: {
  theirs: string;
  mine: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const opening = useEffectEvent(() => mine);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const shown = mountIn(
      element,
      EditorState.create({
        doc: opening(),
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          unifiedMergeView({
            original: theirs,
            mergeControls: false,
            // The lines' colors and marks tell the changes already.
            gutter: false,
            collapseUnchanged: {},
          }),
          FRAME,
          THEME,
          EditorView.contentAttributes.of({
            "aria-label": "Your version against Google Drive's",
          }),
        ],
      }),
    );
    view.current = shown;
    return () => {
      shown.destroy();
      view.current = null;
    };
  }, [theirs]);
  // The user's version follows their typing in the same view, which keeps
  // its place.
  useEffect(() => {
    const shown = view.current;
    // The view joins lines with "\n", whatever the note's line breaks.
    if (!shown || shown.state.doc.toString() === mine.replace(/\r\n?/g, "\n"))
      return;
    shown.dispatch({
      changes: { from: 0, to: shown.state.doc.length, insert: mine },
    });
  }, [mine]);
  return <div className="differences" ref={host} />;
}
