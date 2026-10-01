import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { FileRef } from "./drive.ts";
import { useClimb } from "./path.ts";
import { vaultsQuery } from "./queries.ts";

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
  const roots = new Set(vaults.data.map(({ id }) => id));
  const inVault = climb.data.chain.some(
    ({ id }) => id !== item.id && roots.has(id),
  );
  return inVault ? "in-vault" : "outside";
}
