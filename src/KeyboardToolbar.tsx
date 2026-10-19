import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { findInNote } from "./find.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { keepFocus } from "./keys.ts";
import {
  cycleHeading,
  cycleTask,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleList,
} from "./formatting.ts";
import { keepVisible } from "./visual-viewport.ts";

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
    command: findInNote,
    icon: "search",
  },
];

/**
 * The formatting keys pinned above a touch screen's keyboard while the
 * editor has the focus: the iPhone's keyboard has no Tab key, nor any key
 * for Markdown. The keys never take the focus, so the keyboard stays.
 */
export function KeyboardToolbar({
  onCommand,
  onResize,
}: {
  onCommand: (command: Command) => void;
  /**
   * Runs once the keyboard has come or gone, with the visual viewport's
   * height before.
   */
  onResize: (before: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const resized = useEffectEvent(onResize);
  useLayoutEffect(
    () =>
      bar.current
        ? keepVisible(bar.current, {
            onResize: (before) => {
              resized(before);
            },
          })
        : undefined,
    [],
  );
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      className="keyboard-toolbar"
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
