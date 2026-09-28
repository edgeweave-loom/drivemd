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
  `capabilities(${CAPABILITIES.join(",")}),contentRestrictions(readOnly,reason)`;

// An opened file also needs what the viewer shows and the conflict check
// compares.
const FILE_FIELDS = `${ITEM_FIELDS},modifiedTime,lastModifyingUser(displayName),md5Checksum,headRevisionId`;

const UNREACHABLE = "Google Drive could not be reached";

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
  /** A locked item's content cannot change, whatever the capabilities say. */
  locked: boolean;
  lockReason: string | undefined;
}

export interface FileMetadata extends DriveItem {
  modifiedTime: string | undefined;
  /** Who changed the file last, when a signed-in user did. */
  lastModifiedBy: string | undefined;
  /** Compared before saving, to detect someone else's change. */
  md5Checksum: string | undefined;
  headRevisionId: string | undefined;
}

export interface SharedDrive {
  /** Also the ID of the drive's top folder. */
  id: string;
  name: string;
}

export interface Drive {
  getMetadata: (file: FileRef) => Promise<FileMetadata>;
  /**
   * The bytes of a file whose metadata was just read, exactly as stored.
   * Taking that metadata makes callers read it first: content read before it
   * could be older than the checksum a save compares, and the save would then
   * overwrite someone else's change.
   */
  getContent: (file: FileMetadata) => Promise<Uint8Array>;
  /** Everything in the folder that is not in the trash, from every page. */
  listChildren: (folder: FileRef) => Promise<DriveItem[]>;
  /** The shared drives the user is a member of. */
  listSharedDrives: () => Promise<SharedDrive[]>;
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

  /** Follows nextPageToken until Drive has sent every page. */
  async function list<T>(
    path: string,
    params: Record<string, string>,
    files: FileRef[],
    read: (body: unknown) => Page<T> | undefined,
  ): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams(params);
      if (pageToken !== undefined) query.set("pageToken", pageToken);
      const page = await parse(
        await send(`${API}/${path}?${query.toString()}`, files),
        read,
      );
      items.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return items;
  }

  return {
    async getMetadata(file) {
      const response = await send(fileUrl(file, { fields: FILE_FIELDS }), [
        file,
      ]);
      return parse(response, parseFile);
    },
    async getContent(file) {
      const response = await send(fileUrl(file, { alt: "media" }), [file]);
      if (!response.ok) throw await refusal(response);
      const content = await response.arrayBuffer().catch(() => {
        throw new DriveError(0, UNREACHABLE);
      });
      return new Uint8Array(content);
    },
    async listChildren(folder) {
      const params = {
        q: `'${checked(folder)}' in parents and trashed = false`,
        fields: `nextPageToken,files(${ITEM_FIELDS})`,
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      };
      return list("files", params, [folder], (body) =>
        readPage(body, "files", parseItem),
      );
    },
    async listSharedDrives() {
      const params = {
        fields: "nextPageToken,drives(id,name)",
        pageSize: "100",
      };
      return list("drives", params, [], (body) =>
        readPage(body, "drives", parseSharedDrive),
      );
    },
  };
}

interface Page<T> {
  items: T[];
  nextPageToken: string | undefined;
}

/** A URL for one file, in any drive. */
function fileUrl(file: FileRef, params: Record<string, string>): string {
  const query = new URLSearchParams({ ...params, supportsAllDrives: "true" });
  return `${API}/files/${checked(file)}?${query.toString()}`;
}

/** The file's ID, once it is known to be shaped like a Drive ID. */
function checked(file: FileRef): string {
  // Drive IDs use letters, digits, "-" and "_": any other character could
  // reach another endpoint or change a query, and "." or ".." in a path would
  // be resolved away.
  if (!/^[\w-]+$/.test(file.id)) throw new DriveError(400, "Not a Drive ID");
  return file.id;
}

// The token only ever travels in the Authorization header, and no error
// message quotes the request. Answers skip the HTTP cache, so that a conflict
// check never reads a stale checksum, and no file outlives the session there.
function reach(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store" }).catch(() => {
    throw new DriveError(0, UNREACHABLE);
  });
}

async function refusal(response: Response): Promise<DriveError> {
  const body: unknown = await response.json().catch(() => undefined);
  return new DriveError(
    response.status,
    errorMessage(body) ?? `Google Drive answered ${String(response.status)}`,
  );
}

async function parse<T>(
  response: Response,
  read: (body: unknown) => T | undefined,
): Promise<T> {
  if (!response.ok) throw await refusal(response);
  const body: unknown = await response.json().catch(() => undefined);
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
  const locks = Array.isArray(value.contentRestrictions)
    ? value.contentRestrictions.filter(
        (restriction: unknown): restriction is Record<string, unknown> =>
          isRecord(restriction) && restriction.readOnly === true,
      )
    : [];
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
    locked: locks.length > 0,
    lockReason: locks
      .map((lock) => optionalString(lock.reason))
      .find((reason) => reason !== undefined),
  };
}

function parseFile(value: unknown): FileMetadata | undefined {
  if (!isRecord(value)) return;
  const item = parseItem(value);
  if (!item) return;
  const user = isRecord(value.lastModifyingUser) ? value.lastModifyingUser : {};
  return {
    ...item,
    modifiedTime: optionalString(value.modifiedTime),
    lastModifiedBy: optionalString(user.displayName),
    md5Checksum: optionalString(value.md5Checksum),
    headRevisionId: optionalString(value.headRevisionId),
  };
}

function readPage<T>(
  body: unknown,
  key: string,
  read: (value: Record<string, unknown>) => T | undefined,
): Page<T> | undefined {
  if (!isRecord(body)) return;
  const entries: unknown = body[key];
  const items: T[] = [];
  // Drive may leave out an empty list.
  for (const entry of Array.isArray(entries) ? entries : []) {
    const item = isRecord(entry) ? read(entry) : undefined;
    if (item === undefined) return;
    items.push(item);
  }
  return { items, nextPageToken: optionalString(body.nextPageToken) };
}

function parseSharedDrive(
  value: Record<string, unknown>,
): SharedDrive | undefined {
  const { id, name } = value;
  if (typeof id !== "string" || typeof name !== "string") return;
  return { id, name };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
