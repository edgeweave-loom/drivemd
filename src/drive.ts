import { isRecord } from "./is-record.ts";

const API = "https://www.googleapis.com/drive/v3";

// Only the fields the app shows; the drive scope needs no extra identity scope.
const ABOUT_URL = `${API}/about?fields=user(emailAddress)`;

const CAPABILITIES = [
  "canAddChildren",
  "canComment",
  "canDownload",
  "canEdit",
  "canModifyContent",
  "canMoveItemOutOfDrive",
  "canMoveItemWithinDrive",
  "canRename",
  "canTrash",
] as const;

// What the navigator shows and the actions it offers.
const ITEM_FIELDS =
  "id,name,mimeType,resourceKey,parents,driveId," +
  `capabilities(${CAPABILITIES.join(",")})`;

export class DriveError extends Error {
  override readonly name = "DriveError";
  /** The HTTP status, or 0 when Drive could not be reached. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Where Drive calls get their access token. */
export interface DriveAuth {
  /**
   * A token that is not about to expire. Without a backend, a new token takes
   * a tap on Continue, so this may wait for the user; when it rejects, the
   * call fails with its error.
   */
  token: () => Promise<string>;
  /** Forgets a token Drive refused, unless a newer one already replaced it. */
  forget: (refused: string) => void;
}

/** A file or folder. An item shared by link also needs its resource key. */
export interface FileRef {
  id: string;
  resourceKey?: string | undefined;
}

export type Capability = (typeof CAPABILITIES)[number];

/** What the user may do with an item: whatever Drive does not grant is denied. */
export type Capabilities = Record<Capability, boolean>;

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  resourceKey: string | undefined;
  parents: string[];
  /** The shared drive the item is in, if any. */
  driveId: string | undefined;
  capabilities: Capabilities;
}

export interface Drive {
  getMetadata: (file: FileRef) => Promise<DriveItem>;
}

export async function getAccountEmail(accessToken: string): Promise<string> {
  const response = await reach(ABOUT_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parse(response, (body) => {
    const user = isRecord(body) ? body.user : undefined;
    return isRecord(user) ? optionalString(user.emailAddress) : undefined;
  });
}

export function createDrive(auth: DriveAuth): Drive {
  /** Calls Drive, and after a 401 retries once with a new token. */
  async function send(url: string, files: FileRef[]): Promise<Response> {
    const headers: Record<string, string> = {};
    const keys = files.flatMap(({ id, resourceKey }) =>
      resourceKey ? [`${id}/${resourceKey}`] : [],
    );
    if (keys.length > 0) headers["X-Goog-Drive-Resource-Keys"] = keys.join(",");
    const attempt = async () => {
      const token = await auth.token();
      const response = await reach(url, {
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) auth.forget(token);
      return response;
    };
    const response = await attempt();
    return response.status === 401 ? attempt() : response;
  }

  return {
    async getMetadata(file) {
      const response = await send(fileUrl(file, { fields: ITEM_FIELDS }), [
        file,
      ]);
      return parse(response, (body) =>
        isRecord(body) ? parseItem(body) : undefined,
      );
    },
  };
}

/** A URL for one file, in any drive. */
function fileUrl(file: FileRef, params: Record<string, string>): string {
  // Drive IDs use letters, digits, "-" and "_": any other character in the
  // path could reach another endpoint, and "." or ".." would be resolved away.
  if (!/^[\w-]+$/.test(file.id)) throw new DriveError(400, "Not a Drive ID");
  const query = new URLSearchParams({ ...params, supportsAllDrives: "true" });
  return `${API}/files/${file.id}?${query.toString()}`;
}

// The token only ever travels in the Authorization header, and no error
// message quotes the request.
function reach(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).catch(() => {
    throw new DriveError(0, "Google Drive could not be reached");
  });
}

async function parse<T>(
  response: Response,
  read: (body: unknown) => T | undefined,
): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new DriveError(
      response.status,
      errorMessage(body) ?? `Google Drive answered ${String(response.status)}`,
    );
  }
  const value = read(body);
  if (value === undefined) {
    throw new DriveError(
      response.status,
      "Google Drive sent an unexpected answer",
    );
  }
  return value;
}

function errorMessage(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  return isRecord(error) ? optionalString(error.message) : undefined;
}

function parseItem(value: Record<string, unknown>): DriveItem | undefined {
  const { id, name, mimeType } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string"
  ) {
    return;
  }
  const granted = isRecord(value.capabilities) ? value.capabilities : {};
  return {
    id,
    name,
    mimeType,
    resourceKey: optionalString(value.resourceKey),
    parents: Array.isArray(value.parents)
      ? value.parents.filter(
          (parent: unknown): parent is string => typeof parent === "string",
        )
      : [],
    driveId: optionalString(value.driveId),
    // Complete by construction: one entry for each capability.
    capabilities: Object.fromEntries(
      CAPABILITIES.map((capability) => [
        capability,
        granted[capability] === true,
      ]),
    ) as Capabilities,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
