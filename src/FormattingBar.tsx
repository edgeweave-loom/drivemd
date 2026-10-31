import { historyKeymap, redo, undo } from "@codemirror/commands";
import type { Command, KeyBinding } from "@codemirror/view";
import { Fragment, type KeyboardEvent } from "react";
import { findInNote } from "./find.ts";
import {
  cycleHeading,
  cycleTask,
  FORMATTING_KEYS,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleList,
  toggleNumbered,
  toggleStrikethrough,
} from "./formatting.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { ariaKeys, keepFocus, keyLabel, MAC } from "./keys.ts";

interface Button {
  name: string;
  command: Command;
  icon: IconName;
  /** Whether it changes the lines the cursor is on, which a cell lacks. */
  lines?: true;
}

const GROUPS: Button[][] = [
  [
    { name: "Find in note", command: findInNote, icon: "search" },
    { name: "Undo", command: undo, icon: "undo" },
    { name: "Redo", command: redo, icon: "redo" },
  ],
  [{ name: "Heading", command: cycleHeading, icon: "title", lines: true }],
  [
    { name: "Bold", command: toggleBold, icon: "format_bold" },
    { name: "Italic", command: toggleItalic, icon: "format_italic" },
    {
      name: "Strikethrough",
      command: toggleStrikethrough,
      icon: "strikethrough_s",
    },
    { name: "Code", command: toggleCode, icon: "code" },
    { name: "Link", command: insertLink, icon: "link" },
  ],
  [
    {
      name: "Bulleted list",
      command: toggleList,
      icon: "format_list_bulleted",
      lines: true,
    },
    {
      name: "Numbered list",
      command: toggleNumbered,
      icon: "format_list_numbered",
      lines: true,
    },
    { name: "Checkbox", command: cycleTask, icon: "check_box", lines: true },
  ],
  [
    {
      name: "Outdent",
      command: outdentLines,
      icon: "format_indent_decrease",
      lines: true,
    },
    {
      name: "Indent",
      command: indentLines,
      icon: "format_indent_increase",
      lines: true,
    },
  ],
];

// The keys that run the buttons' commands, Find in note's among them.
const BINDINGS: readonly KeyBinding[] = [
  { key: "Mod-f", run: findInNote },
  ...historyKeymap,
  ...FORMATTING_KEYS,
];

function keyOf(command: Command): string | undefined {
  const binding = BINDINGS.find(({ run }) => run === command);
  return (MAC ? binding?.mac : undefined) ?? binding?.key;
}

/**
 * Moves the focus through the toolbar's buttons, as a toolbar does: the
 * arrows, Home and End move it, and Escape leaves it for the text.
 */
function moveInToolbar(event: KeyboardEvent<HTMLElement>, leave: () => void) {
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (event.key === "Escape") {
    event.preventDefault();
    leave();
    return;
  }
  const to = {
    ArrowRight: (at + 1) % buttons.length,
    ArrowLeft: (at - 1 + buttons.length) % buttons.length,
    Home: 0,
    End: buttons.length - 1,
  }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  buttons[to]?.focus();
}

/**
 * The formatting commands as buttons over the note, as Google Docs shows
 * them, where the pointer is a mouse's or a trackpad's. Each button's name
 * and key show in its tooltip. A click keeps the focus in the text; from
 * the keyboard, Alt+F10 reaches the toolbar, and a button pressed gives the
 * focus back to the text. In a table's cell, the buttons of lines leave,
 * since their marks would break its row.
 */
export function FormattingBar({
  inCell,
  onCommand,
  onLeave,
}: {
  inCell: boolean;
  onCommand: (command: Command) => void;
  /** Gives the focus back to the text. */
  onLeave: () => void;
}) {
  const groups = GROUPS.map((group) =>
    inCell ? group.filter(({ lines }) => !lines) : group,
  ).filter((group) => group.length > 0);
  return (
    <div
      role="toolbar"
      aria-label="Format"
      className="format-bar"
      onMouseDown={keepFocus}
      onKeyDown={(event) => {
        moveInToolbar(event, onLeave);
      }}
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.name}>
          {index > 0 && <hr aria-orientation="vertical" />}
          {group.map(({ name, command, icon }, position) => {
            const key = keyOf(command);
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-keyshortcuts={key && ariaKeys(key)}
                title={key ? `${name} (${keyLabel(key)})` : name}
                // One stop for Tab, the arrows moving between them.
                tabIndex={index === 0 && position === 0 ? 0 : -1}
                onClick={(event) => {
                  const toolbar = event.currentTarget.parentElement;
                  onCommand(command);
                  // From the keyboard, back to the text, unless the command
                  // took the focus elsewhere, as Find in note does.
                  if (toolbar?.contains(document.activeElement)) onLeave();
                }}
              >
                <Icon name={icon} />
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
