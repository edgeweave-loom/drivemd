import { useLayout } from "./layout.ts";
import { getPlace, routeOf } from "./router.ts";
import { read, write } from "./storage.ts";

// Kept by the tab alone, through reloads.
const MARK = "drivemd.fromDrive";
// Copied, with the rest of the tab's storage, into the tab a link opens.
const HANDOFF = "drivemd.handoff";

let marked = false;

/**
 * Marks the tab as one that Drive's Open with opened, as the app starts at
 * the address Drive opens, or else keeps the mark through a reload, Back or
 * Forward: any other address of the app opened in the tab ends the mode.
 */
export function markTab(fromDrive: boolean): void {
  const handed = take(HANDOFF);
  keep(
    fromDrive ||
      handed ||
      (revisited() && read("sessionStorage", MARK) !== null),
  );
}

/**
 * Opens the note a link leads to in a new tab, as Docs opens links, when this
 * tab is one that Drive opened. The browser copies the tab's storage into
 * the new one, token included, so that it does not ask to sign in again (see
 * "Handing the token to a new tab" in docs/SPEC.md). Whether it opened one:
 * a folder, the note shown, or a tab the browser blocked open in place.
 */
export function openNoteTab(href: string): boolean {
  const url = new URL(href, window.location.origin);
  if (!marked || url.origin !== window.location.origin) return false;
  const route = routeOf(url);
  const { route: shown } = getPlace();
  if (route.name !== "file") return false;
  if (shown.name === "file" && shown.file.id === route.file.id) return false;
  write("sessionStorage", HANDOFF, "open");
  try {
    return window.open(url, "_blank") !== null;
  } finally {
    write("sessionStorage", HANDOFF, null);
  }
}

/**
 * Ends the mode as the tab shows another page than a note, as a link to a
 * folder leads to, or Back to a page the tab showed before Drive opened it.
 */
export function leaveNote(): void {
  if (marked) keep(false);
}

function keep(mark: boolean): void {
  marked = mark;
  // Without storage, the mode lasts as long as the page.
  write("sessionStorage", MARK, marked ? "open" : null);
}

/**
 * Whether Drive's Open with opened the tab, which then holds its note alone,
 * as a Docs tab holds one document.
 */
export function openedFromDrive(): boolean {
  return marked;
}

/** Whether the page loads again, rather than at an address opened. */
function revisited(): boolean {
  const [entry] = performance.getEntriesByType("navigation");
  const type = entry && "type" in entry ? entry.type : undefined;
  return type === "reload" || type === "back_forward";
}

/** Reads a one-time value, which no later load of the tab finds. */
function take(key: string): boolean {
  const value = read("sessionStorage", key);
  if (value !== null) write("sessionStorage", key, null);
  return value !== null;
}

/**
 * Where a note's page offers the account: its own button in the bar on a
 * wider screen, or else More actions in a phone's tab opened from Drive,
 * which has no Home that holds it, as a phone's other notes leave it to.
 */
export function useNoteAccount(): "bar" | "more-actions" | undefined {
  if (useLayout() !== "phone") return "bar";
  return marked ? "more-actions" : undefined;
}
