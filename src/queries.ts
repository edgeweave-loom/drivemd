import { QueryClient } from "@tanstack/react-query";
import { DriveError } from "./drive.ts";

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
 * Whether a failed call may pass a moment later: without a connection, when
 * Drive limits the rate, or on a server error. Twice at most, so that the
 * user soon sees what went wrong.
 */
function mayPassLater(failures: number, error: Error): boolean {
  if (failures >= 2 || !(error instanceof DriveError)) return false;
  const { status, rateLimited } = error;
  return status === 0 || rateLimited || status >= 500;
}
