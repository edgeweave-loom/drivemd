import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { DriveItem, FileMetadata, FileRef } from "./drive.ts";
import { useClimb } from "./path.ts";
import { vaultConfigsQuery, vaultSettingsQuery } from "./queries.ts";
import { DEFAULT_SETTINGS, type Vault } from "./vault-settings.ts";

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
  const configs = useQuery({ ...vaultConfigsQuery(drive), enabled });
  // Where the item really is, whatever path the user took to it.
  const climb = useClimb(item, enabled);
  if (!configs.data || !climb.data) {
    return failed(configs) || failed(climb) ? "unknown" : "checking";
  }
  const inVault = nearestVault(climb.data.chain, configs.data) !== undefined;
  return inVault ? "in-vault" : "outside";
}

/**
 * Where a note stands with Obsidian: in a vault, whose settings it follows,
 * outside any, or not known yet, or at all.
 */
export type NoteVault =
  | { state: "checking" | "outside" | "unknown" }
  | { state: "inside"; vault: Vault };

/**
 * The vault the note sits in, the nearest one above it, once Drive has said
 * where the note is, where the vaults are, and how that vault is set; the
 * note's folders are read only when Drive holds a vault.
 */
export function useNoteVault(note: FileRef): NoteVault {
  const { drive } = useDrive();
  const client = useQueryClient();
  const configs = useQuery(vaultConfigsQuery(drive));
  const climb = useClimb(note, Boolean(configs.data?.length));
  const found =
    configs.data && climb.data && nearestVault(climb.data.chain, configs.data);
  const settings = useQuery(vaultSettingsQuery(drive, client, found?.config));
  // A note shown stays as it is while Drive is asked again after failing.
  if (!configs.data) return { state: failed(configs) ? "unknown" : "checking" };
  if (configs.data.length === 0) return { state: "outside" };
  if (!climb.data) return { state: failed(climb) ? "unknown" : "checking" };
  if (!found) return { state: "outside" };
  if (!settings.data && !failed(settings)) return { state: "checking" };
  const { id, resourceKey } = found.root;
  return {
    state: "inside",
    vault: {
      root: { id, resourceKey },
      // A vault whose settings Drive fails to send shows as Obsidian's own do.
      settings: settings.data ?? DEFAULT_SETTINGS,
    },
  };
}

/**
 * Whether Drive failed to answer a query, even as it is asked again: its
 * error then gives way to a wait.
 */
function failed({ errorUpdateCount }: { errorUpdateCount: number }): boolean {
  return errorUpdateCount > 0;
}

/**
 * The top folder of the vault nearest the item, among the folders the item
 * sits in, and that vault's `.obsidian` folder.
 */
function nearestVault(
  chain: FileMetadata[],
  configs: DriveItem[],
): { root: FileMetadata; config: DriveItem } | undefined {
  const byVault = new Map(
    configs.flatMap((config) => config.parents.map((id) => [id, config])),
  );
  // The chain ends with the item itself.
  const root = chain.slice(0, -1).findLast(({ id }) => byVault.has(id));
  const config = root && byVault.get(root.id);
  return root && config && { root, config };
}
