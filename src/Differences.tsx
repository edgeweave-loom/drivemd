import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
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
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const view = mountIn(
      element,
      EditorState.create({
        doc: mine,
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
    return () => {
      view.destroy();
    };
  }, [theirs, mine]);
  return <div className="differences" ref={host} />;
}
