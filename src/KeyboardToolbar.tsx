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
import { keepRoom, keepVisible } from "./visual-viewport.ts";

/** The toolbar's height, which the editor keeps clear of the cursor. */
export const TOOLBAR_HEIGHT = 48;

const KEYS: {
  name: string;
  command: Command;
  icon: IconName;
  /** Whether it changes the lines the cursor is on, which a cell lacks. */
  lines?: true;
}[] = [
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
    lines: true,
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
    lines: true,
  },
  {
    name: "Checkbox",
    command: cycleTask,
    icon: "check_box",
    lines: true,
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
    lines: true,
  },
  {
    name: "Outdent",
    command: outdentLines,
    icon: "format_indent_decrease",
    lines: true,
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
 * for Markdown. The keys never take the focus, so the keyboard stays. In a
 * link, Link opens it instead, as nothing else does from a touch screen.
 * In a table's cell edited in place, the keys of lines are off: their marks
 * would break its row.
 */
export function KeyboardToolbar({
  link,
  inCell = false,
  onCommand,
  onFollow,
  onSettle,
}: {
  /** The address of the link the cursor is in. */
  link: string | undefined;
  /** Whether the cursor is in a table's cell edited in place. */
  inCell?: boolean;
  onCommand: (command: Command) => void;
  onFollow: (href: string) => void;
  /**
   * Runs once the toolbar has settled as it shows, then once the keyboard
   * has come or gone, with the visual viewport's height before.
   */
  onSettle: (before: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const settled = useEffectEvent(onSettle);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const stops = [
      keepVisible(bar.current, {
        onSettle: (before) => {
          settled(before);
        },
      }),
      keepRoom(),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      className="keyboard-toolbar"
    >
      {KEYS.map(({ name, command, icon, lines }) => {
        const follows = command === insertLink ? link : undefined;
        // Off, but still kept from taking the focus, and the keyboard down.
        const off = inCell && lines;
        return (
          <button
            key={name}
            type="button"
            aria-label={follows === undefined ? name : "Open link"}
            aria-disabled={off ? true : undefined}
            onMouseDown={keepFocus}
            onClick={() => {
              if (off) return;
              if (follows === undefined) onCommand(command);
              else onFollow(follows);
            }}
          >
            <Icon name={follows === undefined ? icon : "open_in_new"} />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
