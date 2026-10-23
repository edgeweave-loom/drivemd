import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { oneEditPerKey } from "./one-edit-per-key.ts";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function open() {
  view = new EditorView({
    state: EditorState.create({ doc: "x", extensions: oneEditPerKey }),
  });
  return view;
}

/** The user's tap on `key`: a page cannot dispatch a trusted event itself. */
function press(view: EditorView, key: string) {
  view
    .plugin(oneEditPerKey)
    ?.keydown({ isTrusted: true, key } as KeyboardEvent);
}

/** CodeMirror's replay of `key` to its own commands. */
function replay(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

/** Whether the browser's edit of `inputType` goes ahead. */
function edit(view: EditorView, inputType: string) {
  return view.contentDOM.dispatchEvent(
    new InputEvent("beforeinput", { inputType, cancelable: true }),
  );
}

describe("oneEditPerKey", () => {
  it("cancels the delete that comes after CodeMirror replayed the key", () => {
    const editor = open();

    press(editor, "Backspace");
    replay(editor, "Backspace");

    expect(edit(editor, "deleteContentBackward")).toBe(false);
  });

  it("keeps the delete that comes before the replay", () => {
    const editor = open();

    press(editor, "Backspace");
    expect(edit(editor, "deleteContentBackward")).toBe(true);
    replay(editor, "Backspace");

    expect(edit(editor, "deleteContentBackward")).toBe(true);
  });

  it("cancels the line break that comes after Return was replayed", () => {
    const editor = open();

    press(editor, "Enter");
    replay(editor, "Enter");

    expect(edit(editor, "insertLineBreak")).toBe(false);
  });

  it("cancels the forward delete that comes after Delete was replayed", () => {
    const editor = open();

    press(editor, "Delete");
    replay(editor, "Delete");

    expect(edit(editor, "deleteContentForward")).toBe(false);
  });

  it("keeps another edit after the replay, then cancels the key's", () => {
    const editor = open();

    press(editor, "Enter");
    replay(editor, "Enter");

    expect(edit(editor, "insertReplacementText")).toBe(true);
    expect(edit(editor, "insertParagraph")).toBe(false);
  });

  it("cancels the key's edit only once", () => {
    const editor = open();

    press(editor, "Backspace");
    replay(editor, "Backspace");
    edit(editor, "deleteContentBackward");

    expect(edit(editor, "deleteContentBackward")).toBe(true);
  });

  it("forgets the replay once another key is pressed", () => {
    const editor = open();

    press(editor, "Backspace");
    replay(editor, "Backspace");
    press(editor, "x");

    expect(edit(editor, "deleteContentBackward")).toBe(true);
  });
});
