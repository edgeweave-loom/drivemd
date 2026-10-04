import type { Vault } from "../vault-settings.ts";
import { DEFAULT_SETTINGS } from "../vault-settings.ts";

/** A made-up vault, set as Obsidian sets one by default. */
export const VAULT: Vault = {
  root: { id: "vault" },
  settings: DEFAULT_SETTINGS,
};
