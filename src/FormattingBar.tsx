import { historyKeymap, redo, undo } from "@codemirror/commands";
import type { Command, KeyBinding } from "@codemirror/view";
import {
  Fragment,
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import { CalloutIcon } from "./CalloutIcon.tsx";
import { findInNote } from "./find.ts";
import {
  FORMATTING_KEYS,
  HEADINGS,
  indentLines,
  insertLink,
  outdentLines,
  QUOTE_FORMATS,
  quoteAs,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleQuote,
  toggleStrikethrough,
  type Formats,
} from "./formatting.ts";
import { Icon } from "./Icon.tsx";
import { LISTS } from "./lists.ts";
import { editTable, insertTable, type CellMenu } from "./live-preview.ts";
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
    ...LISTS.map((list) => ({ ...list, lines: true, toggle: true }) as const),
    {
      name: "Quote",
      command: toggleQuote,
      icon: "blockquote",
      lines: true,
      toggle: true,
    },
    { name: "Insert table", command: insertTable, icon: "table", lines: true },
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
 * A toolbar's menu: its id, the element it holds, and the ref that holds
 * it, which focuses its checked item, or else its first, once it opens.
 */
function useMenu() {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const holding = useCallback((element: HTMLDivElement | null) => {
    menu.current = element;
    if (!element) return;
    const opened = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      const item =
        element.querySelector<HTMLElement>('[aria-checked="true"]') ??
        element.querySelector<HTMLElement>('[role^="menuitem"]');
      item?.focus();
    };
    element.addEventListener("toggle", opened);
    return () => {
      element.removeEventListener("toggle", opened);
      menu.current = null;
    };
  }, []);
  return [id, menu, holding] as const;
}

/**
 * The cursor's line's style, as Docs's toolbar gives it: a button naming
 * it, and a menu of text and the six headings, each with its key, the one
 * shown checked. The focus starts at it, and goes back to the text once a
 * style is picked. It is off where no style applies, opening nothing.
 */
function StyleMenu({
  heading,
  off,
  onCommand,
  onLeave,
}: {
  heading: number;
  /** Whether no style applies: in code, the front matter or a task. */
  off: boolean;
  onCommand: (command: Command) => void;
  onLeave: () => void;
}) {
  const [id, menu, holding] = useMenu();
  return (
    <>
      <button
        type="button"
        className="style"
        aria-label="Style"
        aria-haspopup="menu"
        aria-disabled={off || undefined}
        popoverTarget={off ? undefined : id}
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

// Takes the quote around the cursor away, as Style's Normal text a heading.
const NO_QUOTE = quoteAs("text");

/**
 * Quote, in a vault's note, as Style is: a button showing the format of the
 * quote the cursor is in, a plain quote's icon or a callout's in its color,
 * and a menu of No quote, a plain quote, then Obsidian's callout types, each
 * after its icon, that format checked. A format picked sets the quote's.
 */
function QuoteMenu({
  formats,
  off,
  onCommand,
  onLeave,
}: {
  /** Where the cursor is, whose quote's format shows checked. */
  formats: Formats;
  /** Whether it opens nothing: in code, the front matter, or idle. */
  off: boolean;
  onCommand: (command: Command) => void;
  onLeave: () => void;
}) {
  const [id, menu, holding] = useMenu();
  const pick = (command: Command | null) => {
    menu.current?.hidePopover();
    if (command) onCommand(command);
    onLeave();
  };
  return (
    <>
      <button
        type="button"
        className="quote"
        aria-label="Quote"
        aria-haspopup="menu"
        aria-disabled={off || undefined}
        popoverTarget={off ? undefined : id}
        tabIndex={-1}
        title="Quote"
        data-callout={formats.callout ?? undefined}
      >
        {formats.callout ? (
          <CalloutIcon type={formats.callout} />
        ) : (
          <Icon name="blockquote" />
        )}
        <Icon name="arrow_drop_down" />
      </button>
      <div
        ref={holding}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Quote"
        className="menu callout-menu"
        // Its keys stay its own, rather than moving along the toolbar.
        onKeyDown={(event) => {
          event.stopPropagation();
          moveInMenu(event);
        }}
      >
        <button
          type="button"
          role="menuitemradio"
          className="none"
          aria-checked={!formats.quoted}
          onClick={() => {
            pick(formats.quoted ? NO_QUOTE : null);
          }}
        >
          No quote
        </button>
        {QUOTE_FORMATS.map((format) => {
          const checked = format.on(formats);
          return (
            <button
              key={format.name}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              data-callout={format.callout}
              onClick={() => {
                // The checked one leaves the quote as it is, as a radio.
                pick(checked ? null : format.command);
              }}
            >
              {format.callout ? (
                <CalloutIcon type={format.callout} />
              ) : (
                <Icon name={format.icon} />
              )}
              {format.name}
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
 * the formatting around the cursor as buttons pressed; in a vault's note,
 * Quote is a menu, as Style is, of a quote's formats, plain or a callout's.
 * In a table's cell, the style and the buttons of lines leave, since their
 * marks would break its row. Until the note first has the cursor, only Find in
 * note is on: the others would write where no cursor shows.
 */
export function FormattingBar({
  cell,
  vault,
  tableMenu,
  formats,
  idle,
  onCommand,
  onLeave,
  onHold,
}: {
  /**
   * The table's cell edited in place that the cursor is in, if any: the
   * edits that apply, and its column's alignment.
   */
  cell: CellMenu | null;
  /** Whether the note is in a vault, whose callouts Quote's menu makes. */
  vault: boolean;
  /** The table's menu's id, which the Table button opens in a cell. */
  tableMenu: string;
  /** The formatting where the cursor is, which its buttons show pressed. */
  formats: Formats;
  /** Whether the note has not had the cursor yet. */
  idle: boolean;
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
                off={
                  idle || HEADINGS.every((command) => formats.off.has(command))
                }
                onCommand={onCommand}
                onLeave={onLeave}
              />
              <hr aria-orientation="vertical" />
            </>
          )}
          {group.map(({ name, command, icon, toggle }, position) => {
            const key = keyOf(command);
            // Off where it writes nothing, as a table's button.
            const off =
              (idle && command !== findInNote) ||
              (command === insertTable && formats.tableOff) ||
              formats.off.has(command);
            if (command === toggleQuote && vault) {
              return (
                <QuoteMenu
                  key={name}
                  formats={formats}
                  off={idle || formats.calloutOff}
                  onCommand={onCommand}
                  onLeave={onLeave}
                />
              );
            }
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-keyshortcuts={key && ariaKeys(key)}
                aria-pressed={toggle ? formats.on.has(command) : undefined}
                aria-disabled={off || undefined}
                title={key ? `${name} (${keyLabel(key)})` : name}
                // One stop for Tab, the arrows moving between them.
                tabIndex={index === 0 && position === 0 ? 0 : -1}
                onClick={(event) => {
                  if (off) return;
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
