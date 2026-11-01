import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import { Fragment } from "react";
import { findInNote } from "./find.ts";
import {
  cycleHeading,
  cycleTask,
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
import { keepFocus } from "./keys.ts";

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

/**
 * The formatting commands as buttons over the note, as Google Docs shows
 * them, where the pointer is a mouse's or a trackpad's, each button's name
 * in its tooltip. A click keeps the focus in the text. In a table's cell,
 * the buttons of lines leave, since their marks would break its row.
 */
export function FormattingBar({
  inCell,
  onCommand,
}: {
  inCell: boolean;
  onCommand: (command: Command) => void;
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
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.name}>
          {index > 0 && <hr aria-orientation="vertical" />}
          {group.map(({ name, command, icon }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              onClick={() => {
                onCommand(command);
              }}
            >
              <Icon name={icon} />
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
