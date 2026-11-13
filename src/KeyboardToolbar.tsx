import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import {
  Fragment,
  useCallback,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { findInNote } from "./find.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { keepFocus } from "./keys.ts";
import { LISTS } from "./lists.ts";
import {
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleItalic,
  TOGGLE_HEADINGS,
  type Formats,
} from "./formatting.ts";
import { editTable, type CellMenu } from "./live-preview.ts";
import { peekScale, rowItems } from "./peek.ts";
import { ALIGNS, TABLE_EDITS } from "./table-edits.ts";
import { keepRoom, keepVisible } from "./visual-viewport.ts";

/** The toolbar's height, which the editor keeps clear of the cursor. */
export const TOOLBAR_HEIGHT = 48;

interface Item {
  name: string;
  command: Command;
  icon: IconName;
}

type Key = Omit<Item, "command"> & {
  /** Whether it changes the lines the cursor is on, which a cell lacks. */
  lines?: true;
} & (
    | { command: Command; menu?: never }
    | {
        command?: never;
        /** The items of the menu it opens, which show checked where on. */
        menu: readonly Item[];
        /** Whether it takes the icon of its item that is on. */
        showsItem?: true;
      }
  );

const HISTORY: Key[] = [
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
];

const HEADINGS: Item[] = [
  { name: "Heading 1", command: TOGGLE_HEADINGS[0], icon: "format_h1" },
  { name: "Heading 2", command: TOGGLE_HEADINGS[1], icon: "format_h2" },
  { name: "Heading 3", command: TOGGLE_HEADINGS[2], icon: "format_h3" },
];

const KEYS: Key[] = [
  ...HISTORY,
  {
    name: "Heading",
    menu: HEADINGS,
    icon: "title",
    lines: true,
  },
  {
    name: "Bold",
    command: toggleBold,
    icon: "format_bold",
  },
  {
    name: "Italic",
    command: toggleItalic,
    icon: "format_italic",
  },
  {
    name: "List",
    menu: LISTS,
    icon: "format_list_bulleted",
    showsItem: true,
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

// The keys that open a menu, which a table's cell lacks.
const MENU_KEYS = KEYS.flatMap((key) => (key.menu ? [key] : []));

// In a table's cell, the keys that leave its row whole but Undo and Redo,
// which come first, as a key there deletes a row or a column at a tap.
const IN_CELL = KEYS.filter((key) => !HISTORY.includes(key) && !key.lines);

// The table's keys, in their groups, those with none left out.
const TABLE_KEYS = TABLE_EDITS.map((group) =>
  group.flatMap(({ edit, name, icon }) => (icon ? [{ edit, name, icon }] : [])),
).filter((group) => group.length > 0);

/**
 * The formatting keys pinned above a touch screen's keyboard while the
 * editor has the focus: the iPhone's keyboard has no Tab key, nor any key
 * for Markdown. The keys never take the focus, so the keyboard stays. In a
 * link, Link opens it instead, as nothing else does from a touch screen.
 * In a table's cell edited in place, the keys of lines leave, since their
 * marks would break its row, for the table's most frequent edits, its
 * column's alignment pressed; a Table options key, held at the row's right
 * end, opens the table's menu, `tableMenu`, above it, with the others.
 * The keys that do not fit scroll sideways, the last one in view cut in the
 * middle of its icon, under a shade, so that the row shows it scrolls.
 * Heading and List open a menu above them, a row of Heading 1 to 3 and of
 * the formatting toolbar's lists, a ▾ in their corner, and show pressed in
 * their formatting, List with the cursor's list, as do their menus.
 */
export function KeyboardToolbar({
  link,
  cell,
  formats,
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
  /**
   * The formatting where the cursor is, which Heading, List and their menus
   * show.
   */
  formats: Formats;
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
  const row = useRef<HTMLDivElement>(null);
  const menus = useId();
  const inCell = cell !== null;
  useLayoutEffect(() => {
    const keys = row.current;
    if (!keys) return;
    // Its keys anew, from their start, as a cell is entered or left.
    keys.scrollLeft = 0;
    const fit = () => {
      keys.style.removeProperty("--key-scale");
      keys.style.setProperty(
        "--key-scale",
        String(peekScale(rowItems(keys), keys.clientWidth)),
      );
    };
    fit();
    addEventListener("resize", fit);
    return () => {
      removeEventListener("resize", fit);
    };
  }, [inCell]);
  // Typing goes on in the note, under the menu, whose items stay where it
  // opened: it closes, as a tap elsewhere closes it.
  const closing = useCallback((menu: HTMLDivElement | null) => {
    if (!menu) return;
    const close = () => {
      menu.hidePopover();
    };
    const listen = (open: boolean) => {
      for (const type of ["keydown", "beforeinput"]) {
        if (open) document.addEventListener(type, close, true);
        else document.removeEventListener(type, close, true);
      }
    };
    const toggled = (event: Event) => {
      listen((event as ToggleEvent).newState === "open");
    };
    menu.addEventListener("toggle", toggled);
    return () => {
      menu.removeEventListener("toggle", toggled);
      listen(false);
    };
  }, []);
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
  const keyOf = (key: Key) => {
    const { name, command, icon } = key;
    if (key.menu) {
      const on = key.menu.find((item) => formats.on.has(item.command));
      return (
        <button
          key={name}
          type="button"
          className={on ? "menu-key on" : "menu-key"}
          aria-label={name}
          aria-haspopup="menu"
          popoverTarget={`${menus}${name}`}
        >
          <Icon name={key.showsItem && on ? on.icon : icon} />
        </button>
      );
    }
    const follows = command === insertLink ? link : undefined;
    return (
      <button
        key={name}
        type="button"
        aria-label={follows === undefined ? name : "Open link"}
        onClick={() => {
          if (follows !== undefined) onFollow(follows);
          else if (command) onCommand(command);
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
      // Its keys, the rules between them and its edges alike.
      onMouseDown={keepFocus}
    >
      <div ref={row} className="keys">
        {cell ? (
          <>
            {HISTORY.map(keyOf)}
            {TABLE_KEYS.map((group) => (
              <Fragment key={group[0]?.edit}>
                <hr aria-orientation="vertical" />
                {group.map(({ edit, name, icon }) => {
                  const aligning = ALIGNS[edit];
                  // Off where its edit does not apply, which a tap then
                  // leaves undone, as a disabled button would take the focus.
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
          </>
        ) : (
          KEYS.map(keyOf)
        )}
      </div>
      {!cell &&
        MENU_KEYS.map(({ name, menu }) => (
          <div
            key={name}
            ref={closing}
            id={`${menus}${name}`}
            popover="auto"
            role="menu"
            aria-label={name}
            className="key-menu"
          >
            {menu.map((item) => (
              <button
                key={item.name}
                type="button"
                role="menuitemcheckbox"
                aria-label={item.name}
                aria-checked={formats.on.has(item.command)}
                onClick={(event) => {
                  event.currentTarget.parentElement?.hidePopover();
                  onCommand(item.command);
                }}
              >
                <Icon name={item.icon} />
              </button>
            ))}
          </div>
        ))}
      {cell && (
        <>
          <hr aria-orientation="vertical" />
          <button
            type="button"
            className="table-options"
            aria-label="Table options"
            aria-haspopup="menu"
            popoverTarget={tableMenu}
          >
            <Icon name="more_vert" />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
