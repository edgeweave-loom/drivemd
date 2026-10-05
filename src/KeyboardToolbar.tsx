import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { useSyncExternalStore, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import {
  cycleHeading,
  cycleTask,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleList,
} from "./formatting.ts";

/** The toolbar's height, which the editor keeps clear of the cursor. */
export const TOOLBAR_HEIGHT = 48;

// Icons from Google's Material Symbols (Outlined, weight 400), under the
// Apache License 2.0: github.com/google/material-design-icons.
const KEYS: { name: string; command: Command; icon: string }[] = [
  {
    name: "Undo",
    command: undo,
    icon: "M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z",
  },
  {
    name: "Redo",
    command: redo,
    icon: "M396-200q-97 0-166.5-63T160-420q0-94 69.5-157T396-640h252L544-744l56-56 200 200-200 200-56-56 104-104H396q-63 0-109.5 40T240-420q0 60 46.5 100T396-280h284v80H396Z",
  },
  {
    name: "Heading",
    command: cycleHeading,
    icon: "M420-160v-520H200v-120h560v120H540v520H420Z",
  },
  {
    name: "Bold",
    command: toggleBold,
    icon: "M272-200v-560h221q65 0 120 40t55 111q0 51-23 78.5T602-491q25 11 55.5 41t30.5 90q0 89-65 124.5T501-200H272Zm121-112h104q48 0 58.5-24.5T566-372q0-11-10.5-35.5T494-432H393v120Zm0-228h93q33 0 48-17t15-38q0-24-17-39t-44-15h-95v109Z",
  },
  {
    name: "List",
    command: toggleList,
    icon: "M360-200v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm0-240q-33 0-56.5-23.5T120-720q0-33 23.5-56.5T200-800q33 0 56.5 23.5T280-720q0 33-23.5 56.5T200-640Z",
  },
  {
    name: "Checkbox",
    command: cycleTask,
    icon: "m424-312 282-282-56-56-226 226-114-114-56 56 170 170ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z",
  },
  {
    name: "Link",
    command: insertLink,
    icon: "M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z",
  },
  {
    name: "Indent",
    command: indentLines,
    icon: "M120-120v-80h720v80H120Zm320-160v-80h400v80H440Zm0-160v-80h400v80H440Zm0-160v-80h400v80H440ZM120-760v-80h720v80H120Zm0 440v-320l160 160-160 160Z",
  },
  {
    name: "Outdent",
    command: outdentLines,
    icon: "M120-120v-80h720v80H120Zm320-160v-80h400v80H440Zm0-160v-80h400v80H440Zm0-160v-80h400v80H440ZM120-760v-80h720v80H120Zm160 440L120-480l160-160v320Z",
  },
  {
    name: "Find in note",
    command: openSearchPanel,
    icon: "M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z",
  },
];

/**
 * How far the on-screen keyboard rises over the page's bottom edge: the
 * part of the page the visual viewport leaves out below itself.
 */
function keyboardHeight(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(
    0,
    Math.round(window.innerHeight - viewport.offsetTop - viewport.height),
  );
}

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
  };
}

/**
 * Keeps the focus, and the keyboard, with the editor. Only the mouse event
 * that would move it is cancelled: WebKit drops a whole tap, click
 * included, when its pointerdown is.
 */
function keepFocus(event: SyntheticEvent) {
  event.preventDefault();
}

/**
 * The formatting keys pinned above a touch screen's keyboard while the
 * editor has the focus: the iPhone's keyboard has no Tab key, nor any key
 * for Markdown. The keys never take the focus, so the keyboard stays.
 */
export function KeyboardToolbar({
  onCommand,
}: {
  onCommand: (command: Command) => void;
}) {
  const keyboard = useSyncExternalStore(subscribe, keyboardHeight);
  return createPortal(
    <div
      role="toolbar"
      aria-label="Formatting"
      className="keyboard-toolbar"
      // Set through the DOM, which the security policy allows.
      style={{ transform: `translateY(${String(-keyboard)}px)` }}
    >
      {KEYS.map(({ name, command, icon }) => (
        <button
          key={name}
          type="button"
          aria-label={name}
          onMouseDown={keepFocus}
          onClick={() => {
            onCommand(command);
          }}
        >
          <svg viewBox="0 -960 960 960" aria-hidden="true">
            <path d={icon} />
          </svg>
        </button>
      ))}
    </div>,
    document.body,
  );
}
