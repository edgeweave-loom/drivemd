import type { SyntheticEvent } from "react";

export const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

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
 * A CodeMirror key, such as `Mod-Shift-8`, as a Mac writes it, `⌘⇧8`, or
 * as other systems do, `Ctrl+Shift+8`.
 */
export function keyLabel(key: string, mac = MAC): string {
  const parts = key.split("-").map((part) => {
    const named = {
      Mod: mac ? "⌘" : "Ctrl",
      Shift: mac ? "⇧" : "Shift",
      Alt: mac ? "⌥" : "Alt",
    }[part];
    return named ?? part.toUpperCase();
  });
  return parts.join(mac ? "" : "+");
}

/** A CodeMirror key, `Mod-Shift-8`, as `aria-keyshortcuts` writes it. */
export function ariaKeys(key: string, mac = MAC): string {
  return key
    .replace("Mod", mac ? "Meta" : "Control")
    .split("-")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join("+");
}

/**
 * Keeps the focus, and a touch screen's keyboard, where it is as a control
 * is pressed. Only the mouse event that would move it is cancelled: WebKit
 * drops a whole tap, click included, when its pointerdown is.
 */
export function keepFocus(event: SyntheticEvent): void {
  event.preventDefault();
}
