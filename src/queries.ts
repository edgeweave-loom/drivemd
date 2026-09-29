import { QueryClient } from "@tanstack/react-query";
import { DriveError, type FileRef } from "./drive.ts";

// Vaults seldom come and go, and finding them takes a call per vault.
export const VAULTS_STALE_TIME = 5 * 60_000;

/**
 * A cache for Drive's answers. Create one per signed-in account, so that
 * another account never sees them.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A page opened again within half a minute shows what it had, without
      // asking Drive again.
      queries: { retry: mayPassLater, staleTime: 30_000 },
    },
  });
}

/**
 * Has Drive asked again for whatever shows a file that was just created,
 * renamed, moved or trashed: lists, searches, Recent, paths and shortcut
 * checks. The file's own details are asked again only if its page stays.
 */
export function refreshAfterChange(
  client: QueryClient,
  file: FileRef,
  { leaving = false } = {},
): void {
  for (const queryKey of [
    ["children"],
    ["search"],
    ["recent"],
    ["climb"],
    ["shortcut"],
  ]) {
    void client.invalidateQueries({ queryKey });
  }
  void client.invalidateQueries({
    queryKey: ["metadata", file.id],
    refetchType: leaving ? "none" : "active",
  });
}

/**
 * Whether a failed call may pass a moment later: without a connection, when
 * Drive limits the rate, or on a server error. Twice at most, so that the
 * user soon sees what went wrong.
 */
function mayPassLater(failures: number, error: Error): boolean {
  if (failures >= 2 || !(error instanceof DriveError)) return false;
  const { status, rateLimited } = error;
  return status === 0 || rateLimited || status >= 500;
}
