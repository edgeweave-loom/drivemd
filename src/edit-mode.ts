import { read, write } from "./storage.ts";

/** How the editor shows the note: as it reads, or as its Markdown. */
export type EditMode = "visual" | "source";

const KEY = "drivemd.editMode";

/** The mode chosen last on the device: Visual where it keeps none. */
export function lastEditMode(): EditMode {
  return read("localStorage", KEY) === "source" ? "source" : "visual";
}

export function rememberEditMode(mode: EditMode): void {
  write("localStorage", KEY, mode);
}
