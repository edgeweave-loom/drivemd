import { StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Where the last edit took away the one space right before the cursor, as
 * a backspace does, if it did.
 */
const spaceTaken = StateField.define<number | null>({
  create: () => null,
  update: (taken, transaction) => {
    if (!transaction.docChanged) return taken;
    const { main } = transaction.startState.selection;
    let at: number | null = null;
    let changes = 0;
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes += 1;
      if (
        main.empty &&
        main.head === toA &&
        toA - fromA === 1 &&
        inserted.length === 0 &&
        transaction.startState.sliceDoc(fromA, toA) === " "
      ) {
        at = fromA;
      }
    });
    return changes === 1 ? at : null;
  },
});

/**
 * Keeps the two spaces typed after a word, which end a line with Markdown's
 * line break, where Gboard turns them into a period and a space: it takes
 * the first space back, then inserts ". " in one edit, which CodeMirror's
 * own check, made for a period inserted before the space, misses (checked
 * in the Android Emulator, with Gboard 18). A period typed after a backspace
 * comes alone, without the space.
 */
export const keepDoubleSpace: Extension = [
  spaceTaken,
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ". " || from !== to || view.state.field(spaceTaken) !== from) {
      return false;
    }
    view.dispatch({
      changes: { from, insert: "  " },
      selection: { anchor: from + 2 },
      userEvent: "input.type",
    });
    return true;
  }),
];
