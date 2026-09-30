import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import {
  FOLDER,
  MY_DRIVE,
  outOfReach,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { ROOTS } from "./roots.ts";
import { hrefOf, type Crumb } from "./router.ts";

// Drive nests folders 100 deep at most.
const MAX_DEPTH = 100;

/**
 * An item and the folders above it, as far up as the user can reach, and the
 * root they sit in.
 */
export interface Climb {
  root: "my-drive" | "shared-drive" | "shared-with-me";
  /** The topmost folder first, down to the item. */
  chain: FileMetadata[];
}

/** Climbs an item's parents, reading each once through the page cache. */
export function useClimb(item: FileRef, enabled: boolean) {
  const { drive } = useDrive();
  const client = useQueryClient();
  return useQuery({
    queryKey: ["climb", item.id, item.resourceKey],
    queryFn: () =>
      climb(item, (ref) =>
        client.query({
          queryKey: ["metadata", ref.id, ref.resourceKey],
          queryFn: () => drive.getMetadata(ref),
          // The climb as a whole is tried again, reading what came already
          // from the cache.
          retry: false,
        }),
      ),
    enabled,
  });
}

/**
 * The path to an item: the one the user took, or else the one its parents
 * give, once Drive has answered.
 */
export function usePath(
  item: FileRef,
  trail: Crumb[] | undefined,
): Crumb[] | undefined {
  const rebuilt = useClimb(item, trail === undefined);
  return trail ?? (rebuilt.data && crumbsOf(rebuilt.data));
}

/**
 * Climbs from an item to the root it sits in, for an item the user did not
 * reach through the app: up to My Drive, the shared drive, or Shared with me
 * where a parent is out of reach or Drive shows none. `read` reads an item's
 * metadata, from a cache if it can.
 */
export async function climb(
  item: FileRef,
  read: (item: FileRef) => Promise<FileMetadata>,
): Promise<Climb> {
  const chain: FileMetadata[] = [];
  let current: FileMetadata | undefined = await read(item);
  // The item, then the folders above it.
  while (current && chain.length <= MAX_DEPTH) {
    chain.unshift(current);
    // A shared drive's top folder has the drive's ID.
    if (current.driveId === current.id) return { root: "shared-drive", chain };
    const parent: string | undefined = current.parents[0];
    current =
      parent === undefined
        ? undefined
        : await read({ id: parent }).catch(outOfReach);
  }
  // The climb ended at a folder without a parent: My Drive's top one, or an
  // item in someone else's drive.
  const [top] = chain;
  if (top?.parents.length === 0) {
    const myDrive = await read({ id: MY_DRIVE });
    if (myDrive.id === top.id) return { root: "my-drive", chain };
  }
  return { root: "shared-with-me", chain };
}

/** The breadcrumbs of a climb, from its root down to the item. */
export function crumbsOf({ root, chain }: Climb): Crumb[] {
  switch (root) {
    case "my-drive":
      // The root stands for My Drive's top folder.
      return [ROOTS.myDrive, ...chain.slice(1).map(crumbOf)];
    case "shared-drive":
      return [ROOTS.sharedDrives, ...chain.map(crumbOf)];
    case "shared-with-me":
      return [ROOTS.sharedWithMe, ...chain.map(crumbOf)];
  }
}

function crumbOf({ id, name, mimeType, resourceKey }: FileMetadata): Crumb {
  const ref = { id, resourceKey };
  const href = hrefOf(
    mimeType === FOLDER
      ? { name: "folder", folder: ref }
      : { name: "file", file: ref },
  );
  return { name, href };
}
