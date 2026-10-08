// Kept by the tab alone, through reloads.
const MARK = "drivemd.fromDrive";

let marked = false;

/**
 * Marks the tab as one that Drive's Open with opened, as the app starts at
 * the address Drive opens, or else keeps the mark through a reload, Back or
 * Forward: any other address of the app opened in the tab ends the mode.
 */
export function markTab(fromDrive: boolean): void {
  marked = fromDrive || (revisited() && read() !== null);
  try {
    if (marked) sessionStorage.setItem(MARK, "open");
    else sessionStorage.removeItem(MARK);
  } catch {
    // Without storage, the mode lasts as long as the page.
  }
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

function read(): string | null {
  try {
    return sessionStorage.getItem(MARK);
  } catch {
    return null;
  }
}
