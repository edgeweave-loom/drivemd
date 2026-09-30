import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { FileRef } from "./drive.ts";
import { useClimb } from "./path.ts";
import { VAULTS_STALE_TIME } from "./queries.ts";

export type VaultCheck = "in-vault" | "outside" | "checking" | "unknown";

/**
 * Whether the item sits in an Obsidian vault, once Drive has said where it is
 * and where the vaults are; asked only while `enabled`.
 */
export function useVaultCheck(item: FileRef, enabled: boolean): VaultCheck {
  const { drive } = useDrive();
  const vaults = useQuery({
    queryKey: ["vaults"],
    queryFn: drive.findVaults,
    staleTime: VAULTS_STALE_TIME,
    enabled,
  });
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
