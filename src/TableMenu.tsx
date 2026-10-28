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
  ALIGNING,
  editTable,
  tableMenuClosed,
  tableMenuOf,
  type Alignment,
  type CellMenu,
  type TableEdit,
  type TableMenuControl,
} from "./live-preview.ts";
import { moveInMenu } from "./menu.ts";

// Obsidian's items, in its words.
const GROUPS: [TableEdit, string][][] = [
  [
    ["addRowAbove", "Add row above"],
    ["addRowBelow", "Add row below"],
    ["moveRowUp", "Move row up"],
    ["moveRowDown", "Move row down"],
    ["deleteRow", "Delete row"],
  ],
  [
    ["addColumnLeft", "Add column to the left"],
    ["addColumnRight", "Add column to the right"],
    ["moveColumnLeft", "Move column left"],
    ["moveColumnRight", "Move column right"],
    ["deleteColumn", "Delete column"],
  ],
  [
    ["alignLeft", "Align left"],
    ["alignCenter", "Align center"],
    ["alignRight", "Align right"],
  ],
];

const ALIGNS: Partial<Record<TableEdit, Alignment>> = ALIGNING;

// Between the menu and the edges of the room it has.
const MARGIN = 8;

/**
 * Places the menu at a point, upward when `above`, or when null where the
 * room is taller, and leftward from the screen's right half: within the
 * room between the app bar and the keyboard toolbar, the point kept in it,
 * where it scrolls if taller.
 */
function place(menu: HTMLElement, x: number, y: number, above: boolean | null) {
  const top =
    Math.max(
      0,
      document.querySelector(".bar")?.getBoundingClientRect().bottom ?? 0,
    ) + MARGIN;
  const bottom =
    (document.querySelector(".keyboard-toolbar")?.getBoundingClientRect().top ??
      innerHeight) - MARGIN;
  const at = Math.min(bottom, Math.max(top, y));
  const up = above ?? at - top > bottom - at;
  menu.style.left = `${String(x)}px`;
  menu.style.top = `${String(at)}px`;
  menu.style.translate = `${x > innerWidth / 2 ? "-100%" : "0"} ${up ? "-100%" : "0"}`;
  menu.style.maxHeight = `${String(up ? at - top : bottom - at)}px`;
}

/**
 * The menu of a table's cell edited in place, as Obsidian's: its row and
 * its column added, moved or deleted, and its column's alignment, the
 * edits that do not apply off. A right-click opens it at the pointer, its
 * first item focused; on a touch screen, the keyboard toolbar's Table key
 * opens it above the key, its items never taking the focus, so that the
 * keyboard stays up. Closed without an edit, it gives the cell back the
 * focus, unless something else took it.
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
  const [cell, setCell] = useState<CellMenu | null>(null);
  // Where a right-click opens it, rather than above the Table key.
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
        flushSync(() => {
          setCell(now);
        });
        const key = document
          .querySelector(`[popovertarget="${id}"]`)
          ?.getBoundingClientRect();
        if (at) place(element, at.x, at.y, null);
        else if (key) place(element, key.left, key.top, true);
      };
      const closed = (event: Event) => {
        const note = editor.current;
        if ((event as ToggleEvent).newState !== "closed" || !note) return;
        const { activeElement } = document;
        tableMenuClosed(
          note,
          !activeElement ||
            activeElement === document.body ||
            element.contains(activeElement),
        );
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
  return (
    <div
      ref={holding}
      id={id}
      popover="auto"
      role="menu"
      aria-label="Table"
      className="menu table-menu"
      onKeyDown={moveInMenu}
    >
      {GROUPS.map((group, at) => (
        <Fragment key={group[0]?.[0]}>
          {at > 0 && <hr />}
          {group.map(([edit, name]) => {
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
                onMouseDown={keepFocus}
                onClick={() => {
                  const note = editor.current;
                  // An item that is off leaves the menu open.
                  if (note && editTable(note, edit))
                    menu.current?.hidePopover();
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
