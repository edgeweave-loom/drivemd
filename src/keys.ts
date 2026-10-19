import type { SyntheticEvent } from "react";

const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * Whether the command key is down: Cmd on a Mac, where Ctrl+click opens the
 * context menu, and Ctrl elsewhere.
 */
export function commandKey(
  event: { metaKey: boolean; ctrlKey: boolean },
  mac = MAC,
): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

/**
 * Keeps the focus, and a touch screen's keyboard, where it is as a control
 * is pressed. Only the mouse event that would move it is cancelled: WebKit
 * drops a whole tap, click included, when its pointerdown is.
 */
export function keepFocus(event: SyntheticEvent): void {
  event.preventDefault();
}
