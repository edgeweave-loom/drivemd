import type { FileRef } from "./drive.ts";

// The note just created, until its page shows it. Kept in memory alone, so
// that a reload opens it as any note.
let created: string | undefined;

/** Has the note just created open in the editor as its page first shows. */
export function openCreated(file: FileRef): void {
  created = file.id;
}

/** Whether the note was just created, and its page has yet to show it. */
export function justCreated(file: FileRef): boolean {
  return created === file.id;
}

/** The note's page showed it: Back to it, or a link, opens it in reading. */
export function forgetCreated(): void {
  created = undefined;
}
