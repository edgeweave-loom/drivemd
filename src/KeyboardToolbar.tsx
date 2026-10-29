import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import { Fragment, useEffectEvent, useLayoutEffect, useRef } from "react";
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
import { editTable, type CellMenu } from "./live-preview.ts";
import { ALIGNS, TABLE_EDITS } from "./table-edits.ts";
import { keepRoom, keepVisible } from "./visual-viewport.ts";

/** The toolbar's height, which the editor keeps clear of the cursor. */
export const TOOLBAR_HEIGHT = 48;

interface Key {
  name: string;
  command: Command;
  icon: IconName;
  /** Whether it changes the lines the cursor is on, which a cell lacks. */
  lines?: true;
}

const UNDO: Key = {
  name: "Undo",
  command: undo,
  icon: "undo",
};

const KEYS: Key[] = [
  UNDO,
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

// In a table's cell, the keys that leave its row whole but Undo, which
// comes first, as a key there deletes a row or a column at a tap.
const IN_CELL = KEYS.filter((key) => key !== UNDO && !key.lines);

// The table's keys, in their groups.
const TABLE_KEYS = TABLE_EDITS.map((group) =>
  group.flatMap(({ edit, name, icon }) => (icon ? [{ edit, name, icon }] : [])),
);

/**
 * The formatting keys pinned above a touch screen's keyboard while the
 * editor has the focus: the iPhone's keyboard has no Tab key, nor any key
 * for Markdown. The keys never take the focus, so the keyboard stays. In a
 * link, Link opens it instead, as nothing else does from a touch screen.
 * In a table's cell edited in place, the keys of lines leave, since their
 * marks would break its row, for the table's most frequent edits, its
 * column's alignment pressed; a Table options key, last, opens the table's
 * menu, `tableMenu`, above it, with the others.
 */
export function KeyboardToolbar({
  link,
  cell,
  tableMenu,
  onCommand,
  onFollow,
  onSettle,
}: {
  /** The address of the link the cursor is in. */
  link: string | undefined;
  /**
   * The table's cell edited in place that the cursor is in, if any: the
   * edits that apply, and its column's alignment.
   */
  cell: CellMenu | null;
  /** The table's menu's id, which the Table options key opens in a cell. */
  tableMenu: string;
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
  const keyOf = ({ name, command, icon }: Key) => {
    const follows = command === insertLink ? link : undefined;
    return (
      <button
        key={name}
        type="button"
        aria-label={follows === undefined ? name : "Open link"}
        onMouseDown={keepFocus}
        onClick={() => {
          if (follows === undefined) onCommand(command);
          else onFollow(follows);
        }}
      >
        <Icon name={follows === undefined ? icon : "open_in_new"} />
      </button>
    );
  };
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      className="keyboard-toolbar"
    >
      {cell ? (
        <>
          {keyOf(UNDO)}
          {TABLE_KEYS.map((group) => (
            <Fragment key={group[0]?.edit}>
              <hr aria-orientation="vertical" />
              {group.map(({ edit, name, icon }) => {
                const aligning = ALIGNS[edit];
                // Off where its edit does not apply, which a tap then
                // leaves undone, but still kept from taking the focus, and
                // the keyboard down.
                const off = !cell.edits.has(edit);
                return (
                  <button
                    key={edit}
                    type="button"
                    aria-label={name}
                    aria-disabled={off || undefined}
                    aria-pressed={
                      aligning ? cell.alignment === aligning : undefined
                    }
                    onMouseDown={keepFocus}
                    onClick={() => {
                      onCommand((view) => editTable(view, edit));
                    }}
                  >
                    <Icon name={icon} />
                  </button>
                );
              })}
            </Fragment>
          ))}
          <hr aria-orientation="vertical" />
          {IN_CELL.map(keyOf)}
          <button
            type="button"
            className="table-options"
            aria-label="Table options"
            aria-haspopup="menu"
            popoverTarget={tableMenu}
            onMouseDown={keepFocus}
          >
            <Icon name="more_vert" />
          </button>
        </>
      ) : (
        KEYS.map(keyOf)
      )}
    </div>,
    document.body,
  );
}
