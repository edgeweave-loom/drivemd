import type { EditorView } from "@codemirror/view";
import {
  Fragment,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { keepFocus } from "./keys.ts";
import {
  editTable,
  releaseCell,
  tableMenuOf,
  type CellMenu,
  type TableMenuControl,
} from "./live-preview.ts";
import { moveInMenu } from "./menu.ts";
import { ALIGNS, TABLE_EDITS } from "./table-edits.ts";

// Between the menu and the edges of the room it has.
const MARGIN = 8;

/** The room between the app bar and the keyboard toolbar. */
function room(): { top: number; bottom: number } {
  return {
    top:
      Math.max(
        0,
        document.querySelector(".bar")?.getBoundingClientRect().bottom ?? 0,
      ) + MARGIN,
    bottom:
      (document.querySelector(".keyboard-toolbar")?.getBoundingClientRect()
        .top ?? innerHeight) - MARGIN,
  };
}

/**
 * Places the menu at a point, upward or downward, where the room is
 * taller, and leftward from the screen's right half: within the room, the
 * point kept in it, where it scrolls if taller.
 */
function place(menu: HTMLElement, x: number, y: number) {
  const { top, bottom } = room();
  const at = Math.min(bottom, Math.max(top, y));
  const up = at - top > bottom - at;
  menu.style.left = `${String(x)}px`;
  menu.style.top = `${String(at)}px`;
  menu.style.translate = `${x > innerWidth / 2 ? "-100%" : "0"} ${up ? "-100%" : "0"}`;
  menu.style.maxHeight = `${String(up ? at - top : bottom - at)}px`;
}

/**
 * Places the menu above the keyboard toolbar's Table options key, at the
 * key by its CSS anchor, up to the app bar, where it scrolls if taller:
 * with the keyboard up on an iPhone, a menu placed at the key's box from
 * script showed hundreds of pixels above it.
 */
function placeAbove(menu: HTMLElement, key: DOMRect) {
  menu.style.left = "";
  menu.style.top = "";
  menu.style.translate = "";
  menu.style.maxHeight = `${String(key.top - MARGIN - room().top)}px`;
}

/**
 * Places the menu below the formatting toolbar's Table button, at the
 * button by its CSS anchor, down to the screen's bottom, where it scrolls
 * if taller.
 */
function placeBelow(menu: HTMLElement, button: DOMRect) {
  menu.style.left = "";
  menu.style.top = "";
  menu.style.translate = "";
  menu.style.maxHeight = `${String(room().bottom - button.bottom - MARGIN)}px`;
}

/**
 * The menu of a table's cell edited in place, as Obsidian's: a line break
 * in the cell, its row and its column added, moved or deleted, and its
 * column's alignment, the edits that do not apply off. A right-click opens
 * it at the pointer, its first item focused, with the line break's
 * shortcut; on a touch screen, the keyboard toolbar's Table options key
 * opens it above the key, with the items the toolbar lacks, which never
 * take the focus, so that the keyboard stays up; with a mouse, the
 * formatting toolbar's Table button opens it below the button, with the
 * same items and the line break's shortcut, its first item focused when
 * the button was pressed from the keyboard. Closed without an edit, it
 * gives the cell back the focus, unless something else took it.
 */
export function TableMenu({
  id,
  editor,
  ref,
}: {
  id: string;
  editor: RefObject<EditorView | null>;
  ref?: Ref<TableMenuControl>;
}) {
  const menu = useRef<HTMLDivElement>(null);
  // Its cell's edits and alignment, and whether all its items show, as
  // from a right-click, or those the toolbar lacks.
  const [shown, setShown] = useState<{
    cell: CellMenu;
    all: boolean;
    below: boolean;
  } | null>(null);
  // Whether it opens from the keyboard, below the Table button.
  const keyed = useRef(false);
  // Whether one of its edits closes it.
  const picked = useRef(false);
  // Where a right-click opens it, rather than above the Table options key.
  const point = useRef<{ x: number; y: number } | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      openAt(x, y) {
        const element = menu.current;
        if (!element) return;
        point.current = { x, y };
        element.showPopover();
        element.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
      },
      close() {
        menu.current?.hidePopover();
      },
    }),
    [],
  );
  const holding = useCallback(
    (element: HTMLDivElement | null) => {
      menu.current = element;
      if (!element) return;
      const opening = (event: Event) => {
        if ((event as ToggleEvent).newState !== "open") return;
        const note = editor.current;
        const now = note && tableMenuOf(note);
        const at = point.current;
        point.current = null;
        if (!now) {
          event.preventDefault();
          return;
        }
        const button = document.querySelector(`[popovertarget="${id}"]`);
        const below = button?.closest(".format-bar") != null;
        keyed.current = below && document.activeElement === button;
        flushSync(() => {
          setShown({ cell: now, all: at !== null, below });
        });
        if (at) {
          place(element, at.x, at.y);
          return;
        }
        const box = button?.getBoundingClientRect();
        if (!box) return;
        if (below) placeBelow(element, box);
        else placeAbove(element, box);
      };
      const closed = (event: Event) => {
        const note = editor.current;
        if ((event as ToggleEvent).newState === "open" && keyed.current) {
          element.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
        }
        if ((event as ToggleEvent).newState !== "closed" || !note) return;
        const { activeElement } = document;
        const back =
          !activeElement ||
          activeElement === document.body ||
          element.contains(activeElement);
        const button = document.querySelector<HTMLElement>(
          `[popovertarget="${id}"]`,
        );
        const edited = picked.current;
        picked.current = false;
        // Back at its button, as Firefox gives it, the formatting toolbar
        // holds the cell.
        if (activeElement?.closest(".format-bar")) return;
        // Left from the keyboard without an edit, the focus goes back to
        // the button, which WebKit left nowhere.
        if (back && keyed.current && !edited && button) button.focus();
        else releaseCell(note, back);
      };
      element.addEventListener("beforetoggle", opening);
      element.addEventListener("toggle", closed);
      return () => {
        element.removeEventListener("beforetoggle", opening);
        element.removeEventListener("toggle", closed);
        menu.current = null;
      };
    },
    [id, editor],
  );
  const all = shown?.all ?? true;
  const { cell, below = false } = shown ?? {};
  const groups = TABLE_EDITS.map((group) =>
    group.filter(({ icon }) => all || !icon),
  ).filter((group) => group.length > 0);
  return (
    <div
      ref={holding}
      id={id}
      popover="auto"
      role="menu"
      aria-label="Table"
      className={`menu table-menu${all ? "" : below ? " below" : " options"}`}
      onKeyDown={moveInMenu}
    >
      {groups.map((group, at) => (
        <Fragment key={group[0]?.edit}>
          {at > 0 && <hr />}
          {group.map(({ edit, name, keys }) => {
            const aligning = ALIGNS[edit];
            const off = !cell?.edits.has(edit);
            return (
              <button
                key={edit}
                type="button"
                role={aligning ? "menuitemradio" : "menuitem"}
                aria-checked={
                  aligning ? cell?.alignment === aligning : undefined
                }
                aria-disabled={off || undefined}
                aria-keyshortcuts={all || below ? keys : undefined}
                onMouseDown={keepFocus}
                onClick={() => {
                  const note = editor.current;
                  // An item that is off leaves the menu open.
                  if (note && editTable(note, edit)) {
                    picked.current = true;
                    menu.current?.hidePopover();
                  }
                }}
              >
                {name}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
