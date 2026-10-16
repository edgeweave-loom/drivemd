import type { KeyboardEvent } from "react";

/**
 * Moves the focus through a menu's items, as a menu does: the arrows, Home
 * and End move it, and Tab leaves the menu, which closes.
 */
export function moveInMenu(event: KeyboardEvent<HTMLElement>): void {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  ];
  if (event.key === "Tab") {
    event.currentTarget.hidePopover();
    return;
  }
  const at = items.indexOf(event.target as HTMLElement);
  const to = {
    ArrowDown: (at + 1) % items.length,
    ArrowUp: (at - 1 + items.length) % items.length,
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  items[to]?.focus();
}
