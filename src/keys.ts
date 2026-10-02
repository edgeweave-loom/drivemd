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
