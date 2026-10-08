import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Climb } from "./climb.ts";
import { useDrive } from "./drive-context.ts";
import { FOLDER, type FileMetadata, type FileRef } from "./drive.ts";
import { climbQuery, metadataQuery } from "./queries.ts";
import { ROOTS } from "./roots.ts";
import { hrefOf, type Crumb } from "./router.ts";

/** Climbs an item's parents, reading each once through the page cache. */
export function useClimb(item: FileRef, enabled: boolean) {
  const { drive } = useDrive();
  const client = useQueryClient();
  return useQuery({ ...climbQuery(drive, client, item), enabled });
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
 * A folder's details, its path, and its name as the page and a phone's bar
 * give it: from the path, or else from Drive, while Drive is still asked or
 * once it failed to say.
 */
export function useFolder(folder: FileRef, trail: Crumb[] | undefined) {
  const { drive } = useDrive();
  // Says whether the user may add files, and names a folder reached without
  // a path.
  const details = useQuery(metadataQuery(drive, folder));
  const path = usePath(folder, trail);
  const name =
    path?.at(-1)?.name ??
    details.data?.name ??
    (details.isError ? "Folder" : "…");
  return { details, path, name };
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
