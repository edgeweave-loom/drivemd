import { ViewPlugin, type EditorView } from "@codemirror/view";

/** The edits the browser makes for each key that CodeMirror waits for on iOS. */
const EDITS: Partial<Record<string, RegExp>> = {
  Backspace: /^delete\w*Backward$/,
  Delete: /^delete\w*Forward$/,
  Enter: /^insert(Paragraph|LineBreak)$/,
};

/**
 * Keeps one edit for each tap of the delete or Return key on iOS. CodeMirror
 * lets WebKit make the key's edit, then replays the key to its own commands,
 * or replays it after 50 ms when no edit has come. WebKit's edit can come
 * later, after the replay: it then takes a second character, such as the
 * line break before the one the replay took (seen in the iOS 27 Simulator,
 * #202). This cancels an edit that comes after the replay of its key.
 */
export const oneEditPerKey = ViewPlugin.fromClass(
  class {
    /** The key pressed whose edit has not come yet. */
    pressed: string | null = null;
    /** Whether CodeMirror replayed that key before its edit came. */
    replayed = false;

    readonly view: EditorView;

    // CodeMirror keeps the keys it waits for from its own handlers.
    constructor(view: EditorView) {
      this.view = view;
      view.contentDOM.addEventListener("keydown", this.keydown);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("keydown", this.keydown);
    }

    keydown = (event: KeyboardEvent) => {
      if (event.isTrusted) {
        this.pressed = EDITS[event.key] ? event.key : null;
        this.replayed = false;
      } else if (event.key === this.pressed) {
        this.replayed = true;
      }
    };

    /** Whether `event` is the late edit of a key already replayed. */
    late(event: InputEvent): boolean {
      const edit = this.pressed === null ? undefined : EDITS[this.pressed];
      if (!edit?.test(event.inputType)) return false;
      const { replayed } = this;
      this.pressed = null;
      this.replayed = false;
      return replayed;
    }
  },
  {
    eventHandlers: {
      beforeinput(event) {
        return this.late(event);
      },
    },
  },
);
