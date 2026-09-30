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
 * The path to an item: the one the user took, or else the one its parents
 * give, once Drive has answered.
 */
export function usePath(
  item: FileRef,
  trail: Crumb[] | undefined,
): Crumb[] | undefined {
  const { drive } = useDrive();
  const client = useQueryClient();
  const rebuilt = useQuery({
    queryKey: ["path", item.id, item.resourceKey],
    queryFn: () =>
      pathTo(item, (ref) =>
        client.query({
          queryKey: ["metadata", ref.id, ref.resourceKey],
          queryFn: () => drive.getMetadata(ref),
          // The path as a whole is tried again, reading what came already
          // from the cache.
          retry: false,
        }),
      ),
    enabled: trail === undefined,
  });
  return trail ?? rebuilt.data;
}

/**
 * The path from a root to an item, rebuilt from its parents for an item the
 * user did not reach through the app: up to My Drive, the shared drive, or
 * Shared with me where a parent is out of reach or Drive shows none. `read`
 * reads an item's metadata, from a cache if it can.
 */
export async function pathTo(
  item: FileRef,
  read: (item: FileRef) => Promise<FileMetadata>,
): Promise<Crumb[]> {
  const chain: FileMetadata[] = [];
  let current: FileMetadata | undefined = await read(item);
  // The item, then the folders above it.
  while (current && chain.length <= MAX_DEPTH) {
    chain.unshift(current);
    // A shared drive's top folder has the drive's ID.
    if (current.driveId === current.id) {
      return [ROOTS.sharedDrives, ...chain.map(crumbOf)];
    }
    const parent: string | undefined = current.parents[0];
    current =
      parent === undefined
        ? undefined
        : await read({ id: parent }).catch(outOfReach);
  }
  // The climb ended at a folder without a parent: My Drive's top one, or an
  // item in someone else's drive.
  const [top, ...below] = chain;
  if (top?.parents.length === 0) {
    const myDrive = await read({ id: MY_DRIVE });
    if (myDrive.id === top.id) return [ROOTS.myDrive, ...below.map(crumbOf)];
  }
  return [ROOTS.sharedWithMe, ...chain.map(crumbOf)];
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
