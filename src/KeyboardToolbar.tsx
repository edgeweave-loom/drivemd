import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { useSyncExternalStore, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
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

const KEYS: { name: string; command: Command; icon: IconName }[] = [
  {
    name: "Undo",
    command: undo,
    icon: "undo",
  },
  {
    name: "Redo",
    command: redo,
    icon: "redo",
  },
  {
    name: "Heading",
    command: cycleHeading,
    icon: "title",
  },
  {
    name: "Bold",
    command: toggleBold,
    icon: "format_bold",
  },
  {
    name: "List",
    command: toggleList,
    icon: "format_list_bulleted",
  },
  {
    name: "Checkbox",
    command: cycleTask,
    icon: "check_box",
  },
  {
    name: "Link",
    command: insertLink,
    icon: "link",
  },
  {
    name: "Indent",
    command: indentLines,
    icon: "format_indent_increase",
  },
  {
    name: "Outdent",
    command: outdentLines,
    icon: "format_indent_decrease",
  },
  {
    name: "Find in note",
    command: openSearchPanel,
    icon: "search",
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
          <Icon name={icon} />
        </button>
      ))}
    </div>,
    document.body,
  );
}
