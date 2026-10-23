import { deleteCharBackward } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { keepDoubleSpace } from "./double-space.ts";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

/** An editor holding `text`, its cursor at the end. */
function open(text: string) {
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: keepDoubleSpace,
    }),
  });
  return view;
}

/**
 * Replaces `from` to `to` with `text` as a keyboard does, through the
 * handlers, the cursor ending after it.
 */
function replace(view: EditorView, from: number, to: number, text: string) {
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) =>
      handler(view, from, to, text, () =>
        view.state.update({ changes: { from, to, insert: text } }),
      ),
    );
  if (!handled) {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }
}

/** Inserts `text` at the cursor as a keyboard does, through the handlers. */
function type(view: EditorView, text: string) {
  const at = view.state.selection.main.head;
  replace(view, at, at, text);
}

describe("keepDoubleSpace", () => {
  it("keeps two spaces where Gboard takes one back and inserts a period", () => {
    const editor = open("word ");

    deleteCharBackward(editor);
    type(editor, ". ");

    expect(editor.state.sliceDoc()).toBe("word  ");
    expect(editor.state.selection.main.head).toBe(6);
  });

  it("keeps a period typed after a backspace", () => {
    const editor = open("word ");

    deleteCharBackward(editor);
    type(editor, ".");

    expect(editor.state.sliceDoc()).toBe("word.");
  });

  it("keeps a period and a space inserted without a space taken back", () => {
    const editor = open("word");

    type(editor, ". ");

    expect(editor.state.sliceDoc()).toBe("word. ");
  });

  it("keeps a period and a space inserted after another backspace", () => {
    const editor = open("words");

    deleteCharBackward(editor);
    type(editor, ". ");

    expect(editor.state.sliceDoc()).toBe("word. ");
  });

  it("keeps two spaces where iOS puts a period in place of the first", () => {
    const editor = open("word ");

    replace(editor, 4, 5, ".");
    type(editor, " ");

    expect(editor.state.sliceDoc()).toBe("word  ");
    expect(editor.state.selection.main.head).toBe(6);
  });

  it("keeps a period typed over a selected space", () => {
    const editor = open("word ");
    editor.dispatch({ selection: { anchor: 4, head: 5 } });

    replace(editor, 4, 5, ".");

    expect(editor.state.sliceDoc()).toBe("word.");
  });

  it("forgets the space taken back once another edit comes", () => {
    const editor = open("word ");

    deleteCharBackward(editor);
    type(editor, "s");
    deleteCharBackward(editor);
    type(editor, ". ");

    expect(editor.state.sliceDoc()).toBe("word. ");
  });
});
