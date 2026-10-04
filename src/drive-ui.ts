import { isDriveId, type FileRef } from "./drive.ts";
import { isRecord } from "./is-record.ts";

/** What Drive on the web asks of the app, through its Open with. */
export interface DriveRequest {
  action: "open";
  file: FileRef;
  /** The Google profile ID of the account Drive acted as, if it says. */
  account?: string;
}

/**
 * What Drive asks, from the address it opened the tab at: Open with names
 * the files to open, of which the app opens the first, with its resource
 * key. A state not shaped as Drive writes it asks nothing.
 */
export function requestFromDrive(url: URL): DriveRequest | undefined {
  // A trailing slash names the same page, as for the app's other pages.
  if (url.pathname.replace(/(.)\/$/, "$1") !== "/open") return;
  const state = parse(url.searchParams.get("state"));
  if (!isObject(state) || state.action !== "open") return;
  const { ids, resourceKeys = {}, userId } = state;
  const id: unknown = Array.isArray(ids) ? ids[0] : undefined;
  if (typeof id !== "string" || !isDriveId(id) || !isObject(resourceKeys)) {
    return;
  }
  const resourceKey = Object.hasOwn(resourceKeys, id)
    ? resourceKeys[id]
    : undefined;
  if (resourceKey !== undefined && !isShaped(resourceKey)) return;
  if (userId !== undefined && !isShaped(userId)) return;
  return {
    action: "open",
    file: resourceKey === undefined ? { id } : { id, resourceKey },
    ...(userId !== undefined && { account: userId }),
  };
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
