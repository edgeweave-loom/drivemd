import { isDriveId, MY_DRIVE, type FileRef } from "./drive.ts";
import { isRecord } from "./is-record.ts";

/** What Drive on the web asks of the app, through Open with or New. */
export type DriveRequest = (
  { action: "open"; file: FileRef } | { action: "create"; folder: FileRef }
) & {
  /** The Google profile ID of the account Drive acted as, if it says. */
  account?: string;
};

/**
 * What Drive asks, from the address it opened the tab at: Open with names
 * the files to open, of which the app opens the first, and New the folder to
 * create a file in, each with its resource key. A state not shaped as Drive
 * writes it asks nothing.
 */
export function requestFromDrive(url: URL): DriveRequest | undefined {
  // A trailing slash names the same page, as for the app's other pages.
  const path = url.pathname.replace(/(.)\/$/, "$1");
  const state = parse(url.searchParams.get("state"));
  if (!isObject(state)) return;
  const { action, userId } = state;
  if (userId !== undefined && !isShaped(userId)) return;
  const account = userId === undefined ? {} : { account: userId };
  if (path === "/open" && action === "open") {
    const file = fileOpened(state);
    return file && { action, file, ...account };
  }
  if (path !== "/new" || action !== "create") return;
  const folder = folderNamed(state);
  return folder && { action, folder, ...account };
}

/** The first file that Open with names. */
function fileOpened({
  ids,
  resourceKeys = {},
}: Record<string, unknown>): FileRef | undefined {
  const id: unknown = Array.isArray(ids) ? ids[0] : undefined;
  if (!isShaped(id) || !isObject(resourceKeys)) return;
  return item(
    id,
    Object.hasOwn(resourceKeys, id) ? resourceKeys[id] : undefined,
  );
}

/** The folder that New creates a file in: My Drive's top one if none. */
function folderNamed({
  folderId,
  folderResourceKey,
}: Record<string, unknown>): FileRef | undefined {
  if (folderId === undefined) {
    return folderResourceKey === undefined ? { id: MY_DRIVE } : undefined;
  }
  return isShaped(folderId) ? item(folderId, folderResourceKey) : undefined;
}

function item(id: string, resourceKey: unknown): FileRef | undefined {
  if (resourceKey === undefined) return { id };
  return isShaped(resourceKey) ? { id, resourceKey } : undefined;
}

function parse(text: string | null): unknown {
  if (text === null) return;
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

/** A JSON object, not a list. */
function isObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

/** Text shaped like Drive's IDs and keys, or Google's profile IDs. */
function isShaped(value: unknown): value is string {
  return typeof value === "string" && isDriveId(value);
}
