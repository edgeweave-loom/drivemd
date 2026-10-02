import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useEffectEvent, useRef } from "react";
import { mountIn, THEME } from "./codemirror.ts";

/**
 * The user's version against Google Drive's, in one view that reads the
 * same on a phone: what the user's version removes shows struck through in
 * place, and what it adds highlighted. Long stretches alike fold away.
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
            collapseUnchanged: {},
          }),
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
