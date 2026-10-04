import {
  DriveError,
  FOLDER,
  MY_DRIVE,
  SHORTCUT,
  type DriveItem,
  type FileMetadata,
  type FileRef,
} from "../drive.ts";

export { FOLDER, SHORTCUT };

/** A made-up Markdown file the user can do anything with, unless changed. */
export function driveItem(
  name: string,
  changes: Partial<DriveItem> = {},
): DriveItem {
  return {
    id: `id-${name.replace(/\W/g, "_")}`,
    name,
    mimeType: "text/markdown",
    resourceKey: undefined,
    parents: ["parent"],
    driveId: undefined,
    target: undefined,
    capabilities: {
      canAddChildren: false,
      canComment: true,
      canDownload: true,
      canEdit: true,
      canModifyContent: true,
      canMoveItemOutOfDrive: true,
      canMoveItemWithinDrive: true,
      canRename: true,
      canTrash: true,
    },
    locked: false,
    lockReason: undefined,
    ...changes,
  };
}

export function folderItem(
  name: string,
  changes: Partial<DriveItem> = {},
): DriveItem {
  return driveItem(name, { mimeType: FOLDER, ...changes });
}

export function shortcutItem(name: string, targetType: string): DriveItem {
  return driveItem(name, {
    mimeType: SHORTCUT,
    target: { id: `target-${name}`, mimeType: targetType, resourceKey: "key" },
  });
}

export function metadata(
  item: DriveItem,
  changes: Partial<FileMetadata> = {},
): FileMetadata {
  return {
    ...item,
    modifiedTime: "2026-09-01T10:00:00.000Z",
    lastModifiedBy: "Ada Lovelace",
    md5Checksum: "0123456789abcdef0123456789abcdef",
    headRevisionId: "revision-1",
    size: 100,
    trashed: false,
    ...changes,
  };
}

/** My Drive's top folder, which Drive also answers to as "root". */
export const MY_DRIVE_ROOT = metadata(
  folderItem("My Drive", { id: "my-root", parents: [] }),
);

/**
 * Reads the metadata of made-up items, and My Drive's, by ID, as Drive's
 * getMetadata would: an unknown ID is not found.
 */
export function metadataOf(...items: FileMetadata[]) {
  const byId = new Map(
    [MY_DRIVE_ROOT, ...items].map((item) => [item.id, item]),
  );
  return (ref: FileRef): Promise<FileMetadata> => {
    const item = byId.get(ref.id === MY_DRIVE ? MY_DRIVE_ROOT.id : ref.id);
    return item
      ? Promise.resolve(item)
      : Promise.reject(new DriveError(404, `File not found: ${ref.id}.`));
  };
}

/** Lists, as Drive's listFolders would, the folders among made-up items. */
export function foldersAmong(items: DriveItem[]) {
  return (folders: FileRef[]): Promise<DriveItem[]> =>
    Promise.resolve(
      items.filter(
        ({ mimeType, parents }) =>
          mimeType === FOLDER && folders.some(({ id }) => parents.includes(id)),
      ),
    );
}
