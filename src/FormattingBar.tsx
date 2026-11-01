import { historyKeymap, redo, undo } from "@codemirror/commands";
import type { Command, KeyBinding } from "@codemirror/view";
import {
  Fragment,
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import { findInNote } from "./find.ts";
import {
  cycleTask,
  FORMATTING_KEYS,
  HEADINGS,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleList,
  toggleNumbered,
  toggleQuote,
  toggleStrikethrough,
  type Formats,
} from "./formatting.ts";
import { Icon } from "./Icon.tsx";
import { editTable, type CellMenu } from "./live-preview.ts";
import { ALIGNS, TABLE_EDITS } from "./table-edits.ts";
import type { IconName } from "./icons.ts";
import { ariaKeys, keepFocus, keyLabel, MAC } from "./keys.ts";
import { moveInMenu } from "./menu.ts";

interface Button {
  name: string;
  command: Command;
  icon: IconName;
  /** Whether it changes the lines the cursor is on, which a cell lacks. */
  lines?: true;
  /** Whether it takes its formatting away where the cursor is in it. */
  toggle?: true;
}

const GROUPS: Button[][] = [
  [
    { name: "Find in note", command: findInNote, icon: "search" },
    { name: "Undo", command: undo, icon: "undo" },
    { name: "Redo", command: redo, icon: "redo" },
  ],
  [
    { name: "Bold", command: toggleBold, icon: "format_bold", toggle: true },
    {
      name: "Italic",
      command: toggleItalic,
      icon: "format_italic",
      toggle: true,
    },
    {
      name: "Strikethrough",
      command: toggleStrikethrough,
      icon: "strikethrough_s",
      toggle: true,
    },
    { name: "Code", command: toggleCode, icon: "code", toggle: true },
    { name: "Link", command: insertLink, icon: "link" },
  ],
  [
    {
      name: "Bulleted list",
      command: toggleList,
      icon: "format_list_bulleted",
      lines: true,
      toggle: true,
    },
    {
      name: "Numbered list",
      command: toggleNumbered,
      icon: "format_list_numbered",
      lines: true,
      toggle: true,
    },
    {
      name: "Checkbox",
      command: cycleTask,
      icon: "check_box",
      lines: true,
      toggle: true,
    },
    {
      name: "Quote",
      command: toggleQuote,
      icon: "format_quote",
      lines: true,
      toggle: true,
    },
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
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(":scope > button"),
  ];
  const at = buttons.indexOf(event.target as HTMLElement);
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

// The table's edits with an icon, in their groups, as the keyboard
// toolbar's keys in a cell.
const TABLE_BUTTONS = TABLE_EDITS.map((group) =>
  group.flatMap(({ edit, name, icon }) => (icon ? [{ edit, name, icon }] : [])),
).filter((group) => group.length > 0);

const STYLES = [
  "Normal text",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Heading 4",
  "Heading 5",
  "Heading 6",
];

/**
 * The cursor's line's style, as Docs's toolbar gives it: a button naming
 * it, and a menu of text and the six headings, each with its key, the one
 * shown checked. The focus starts at it, and goes back to the text once a
 * style is picked.
 */
function StyleMenu({
  heading,
  onCommand,
  onLeave,
}: {
  heading: number;
  onCommand: (command: Command) => void;
  onLeave: () => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const holding = useCallback((element: HTMLDivElement | null) => {
    menu.current = element;
    if (!element) return;
    const opened = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      element.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    };
    element.addEventListener("toggle", opened);
    return () => {
      element.removeEventListener("toggle", opened);
      menu.current = null;
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="style"
        aria-label="Style"
        aria-haspopup="menu"
        popoverTarget={id}
        tabIndex={-1}
        title="Style"
      >
        {STYLES[heading]}
        <Icon name="arrow_drop_down" />
      </button>
      <div
        ref={holding}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Style"
        className="menu style-menu"
        // Its keys stay its own, rather than moving along the toolbar.
        onKeyDown={(event) => {
          event.stopPropagation();
          moveInMenu(event);
        }}
      >
        {HEADINGS.map((command, level) => {
          const key = keyOf(command);
          return (
            <button
              key={STYLES[level]}
              type="button"
              role="menuitemradio"
              aria-checked={level === heading}
              aria-keyshortcuts={key && ariaKeys(key)}
              onClick={() => {
                menu.current?.hidePopover();
                onCommand(command);
                onLeave();
              }}
            >
              {STYLES[level]}
              {/* Its aria-keyshortcuts tells it. */}
              {key && (
                <span className="key" aria-hidden="true">
                  {keyLabel(key)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The formatting commands as buttons over the note, as Google Docs shows
 * them, where the pointer is a mouse's or a trackpad's. Each button's name
 * and key show in its tooltip. A click keeps the focus in the text; from
 * the keyboard, Alt+F10 reaches the toolbar, and a button pressed gives the
 * focus back to the text. The cursor's line's style shows in its menu, and
 * the formatting around the cursor as buttons pressed. In a table's cell,
 * the style and the buttons of lines leave, since their marks would break
 * its row.
 */
export function FormattingBar({
  cell,
  tableMenu,
  formats,
  onCommand,
  onLeave,
  onHold,
}: {
  /**
   * The table's cell edited in place that the cursor is in, if any: the
   * edits that apply, and its column's alignment.
   */
  cell: CellMenu | null;
  /** The table's menu's id, which the Table button opens in a cell. */
  tableMenu: string;
  /** The formatting where the cursor is, which its buttons show pressed. */
  formats: Formats;
  onCommand: (command: Command) => void;
  /** Gives the focus back to the text. */
  onLeave: () => void;
  /**
   * Keeps a table's cell edited while the focus is in the toolbar, or lets
   * it go once the focus leaves, `back` to it where the focus went nowhere.
   */
  onHold: (held: boolean, back: boolean) => void;
}) {
  const inCell = cell !== null;
  const groups = GROUPS.map((group) =>
    inCell ? group.filter(({ lines }) => !lines) : group,
  ).filter((group) => group.length > 0);
  // From the keyboard, back to the text, unless the command took the focus
  // elsewhere, as Find in note does.
  const left = (toolbar: Element | null) => {
    if (toolbar?.contains(document.activeElement)) onLeave();
  };
  return (
    <div
      role="toolbar"
      aria-label="Format"
      className="format-bar"
      onMouseDown={keepFocus}
      onKeyDown={(event) => {
        moveInToolbar(event, onLeave);
      }}
      onFocus={() => {
        onHold(true, false);
      }}
      onBlur={(event) => {
        const to = event.relatedTarget;
        // Within it, or into the table's menu, which holds the cell too.
        if (to?.closest(`.format-bar, [id="${tableMenu}"]`)) return;
        onHold(false, to === null);
      }}
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.name}>
          {index > 0 && <hr aria-orientation="vertical" />}
          {index === 1 && !inCell && (
            <>
              <StyleMenu
                heading={formats.heading}
                onCommand={onCommand}
                onLeave={onLeave}
              />
              <hr aria-orientation="vertical" />
            </>
          )}
          {group.map(({ name, command, icon, toggle }, position) => {
            const key = keyOf(command);
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-keyshortcuts={key && ariaKeys(key)}
                aria-pressed={toggle ? formats.on.has(command) : undefined}
                title={key ? `${name} (${keyLabel(key)})` : name}
                // One stop for Tab, the arrows moving between them.
                tabIndex={index === 0 && position === 0 ? 0 : -1}
                onClick={(event) => {
                  const toolbar = event.currentTarget.parentElement;
                  onCommand(command);
                  left(toolbar);
                }}
              >
                <Icon name={icon} />
              </button>
            );
          })}
        </Fragment>
      ))}
      {cell &&
        TABLE_BUTTONS.map((group) => (
          <Fragment key={group[0]?.edit}>
            <hr aria-orientation="vertical" />
            {group.map(({ edit, name, icon }) => {
              const aligning = ALIGNS[edit];
              return (
                <button
                  key={edit}
                  type="button"
                  aria-label={name}
                  title={name}
                  tabIndex={-1}
                  // Off where its edit does not apply, as the keyboard
                  // toolbar's keys are, a click leaving it undone.
                  aria-disabled={!cell.edits.has(edit) || undefined}
                  aria-pressed={
                    aligning ? cell.alignment === aligning : undefined
                  }
                  onClick={(event) => {
                    const toolbar = event.currentTarget.parentElement;
                    onCommand((view) => editTable(view, edit));
                    left(toolbar);
                  }}
                >
                  <Icon name={icon} />
                </button>
              );
            })}
          </Fragment>
        ))}
      {cell && (
        <>
          <hr aria-orientation="vertical" />
          <button
            type="button"
            className="table"
            aria-haspopup="menu"
            popoverTarget={tableMenu}
            tabIndex={-1}
            title="Table"
          >
            Table
            <Icon name="arrow_drop_down" />
          </button>
        </>
      )}
    </div>
  );
}
