import {
  FOLDER,
  SHORTCUT,
  type DriveItem,
  type FileMetadata,
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
    ...changes,
  };
}
