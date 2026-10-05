import {
  MY_DRIVE,
  outOfReach,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";

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
