import { isRecord } from "./is-record.ts";

/** The settings of an Obsidian vault that change how its notes show. */
export interface VaultSettings {
  /** Lines join as Markdown joins them, rather than break where the note does. */
  strictLineBreaks: boolean;
}

/** Obsidian's own settings, which hold for what a vault leaves unset. */
export const DEFAULT_SETTINGS: VaultSettings = { strictLineBreaks: false };

/**
 * The settings a vault's `.obsidian/app.json` holds, with Obsidian's own for
 * a key it leaves out or a file that is not JSON, as Obsidian reads it.
 */
export function readSettings(bytes: Uint8Array): VaultSettings {
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return DEFAULT_SETTINGS;
  }
  return {
    strictLineBreaks: isRecord(settings) && settings.strictLineBreaks === true,
  };
}
