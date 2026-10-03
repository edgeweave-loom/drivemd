import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { DriveItem, FileMetadata, FileRef } from "./drive.ts";
import { useClimb } from "./path.ts";
import { vaultSettingsQuery, vaultsQuery } from "./queries.ts";
import { DEFAULT_SETTINGS, type VaultSettings } from "./vault-settings.ts";

export type VaultCheck = "in-vault" | "outside" | "checking" | "unknown";

/**
 * What to say before a note is renamed or moved, as the vault check stands:
 * links to it in other notes will not follow.
 */
export function vaultNote(
  check: VaultCheck,
  change: "renames" | "moves",
): string | undefined {
  switch (check) {
    case "checking":
      return "Checking whether this note is in an Obsidian vault…";
    case "in-vault":
      return `This note is in an Obsidian vault. Links to it in other notes will not be updated: Obsidian updates them only when it ${change} a note itself.`;
    case "unknown":
      return "DriveMD could not check whether this note is in an Obsidian vault. If it is, links to it in other notes will not be updated.";
    case "outside":
      return undefined;
  }
}

/**
 * Whether the item sits in an Obsidian vault, once Drive has said where it is
 * and where the vaults are; asked only while `enabled`.
 */
export function useVaultCheck(item: FileRef, enabled: boolean): VaultCheck {
  const { drive } = useDrive();
  const vaults = useQuery({ ...vaultsQuery(drive), enabled });
  // Where the item really is, whatever path the user took to it.
  const climb = useClimb(item, enabled);
  if (vaults.isError || climb.isError) return "unknown";
  if (!vaults.data || !climb.data) return "checking";
  const inVault = nearestVault(climb.data.chain, vaults.data) !== undefined;
  return inVault ? "in-vault" : "outside";
}

/**
 * Where a note stands with Obsidian: in a vault, whose settings it follows,
 * outside any, or not known yet, or at all.
 */
export type NoteVault =
  | { state: "checking" | "outside" | "unknown" }
  | { state: "inside"; settings: VaultSettings };

/**
 * The vault the note sits in, the nearest one above it, once Drive has said
 * where the note is, where the vaults are, and how that vault is set; the
 * note's folders are read only when Drive holds a vault.
 */
export function useNoteVault(note: FileRef): NoteVault {
  const { drive } = useDrive();
  const client = useQueryClient();
  const vaults = useQuery(vaultsQuery(drive));
  const climb = useClimb(note, Boolean(vaults.data?.length));
  const vault =
    vaults.data && climb.data && nearestVault(climb.data.chain, vaults.data);
  // A vault whose settings Drive fails to send shows as Obsidian's own do.
  const settings = useQuery(vaultSettingsQuery(drive, client, vault));
  if (!vaults.data) return { state: vaults.isError ? "unknown" : "checking" };
  if (vaults.data.length === 0) return { state: "outside" };
  if (!climb.data) return { state: climb.isError ? "unknown" : "checking" };
  if (!vault) return { state: "outside" };
  if (settings.isPending) return { state: "checking" };
  return { state: "inside", settings: settings.data ?? DEFAULT_SETTINGS };
}

/** The vault nearest the item above it, among the folders the item sits in. */
function nearestVault(
  chain: FileMetadata[],
  vaults: DriveItem[],
): FileMetadata | undefined {
  const roots = new Set(vaults.map(({ id }) => id));
  // The chain ends with the item itself.
  return chain.slice(0, -1).findLast(({ id }) => roots.has(id));
}
