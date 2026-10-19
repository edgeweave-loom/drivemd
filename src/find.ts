import {
  openSearchPanel,
  searchPanelOpen,
  type SearchQuery,
} from "@codemirror/search";
import {
  StateEffect,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import type { Command } from "@codemirror/view";

// Matches past this many are not counted, which a keystroke would wait on.
export const MAX_COUNTED = 1000;

/** How many matches the query finds, and which of them is selected. */
export interface Matches {
  total: number;
  /** The selected match's place among them, from 1. */
  current: number | undefined;
}

/** The query's matches in the note, counted up to one past MAX_COUNTED. */
export function countMatches(state: EditorState, query: SearchQuery): Matches {
  const { from, to } = state.selection.main;
  let total = 0;
  let current: number | undefined;
  if (!query.valid) return { total, current };
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total > MAX_COUNTED) break;
  }
  return { total, current };
}

const focusFind = StateEffect.define();

/**
 * Opens Find in note, or gives its field the focus again where it is open:
 * the field is the page's, outside the editor, where CodeMirror's own
 * command would look for it.
 */
export const findInNote: Command = (view) => {
  if (!searchPanelOpen(view.state)) return openSearchPanel(view);
  view.dispatch({ effects: focusFind.of(null) });
  return true;
};

/** Whether the transaction opens Find in note or asks for its field. */
export function findsInNote(transaction: Transaction): boolean {
  return (
    (searchPanelOpen(transaction.state) &&
      !searchPanelOpen(transaction.startState)) ||
    transaction.effects.some((effect) => effect.is(focusFind))
  );
}
