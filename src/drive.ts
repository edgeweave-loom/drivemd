import { isRecord } from "./is-record.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

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

// What the navigator shows, where shortcuts point, and the actions it offers.
const ITEM_FIELDS =
  "id,name,mimeType,resourceKey,parents,driveId," +
  "shortcutDetails(targetId,targetMimeType,targetResourceKey)," +
  `capabilities(${CAPABILITIES.join(",")}),contentRestrictions(readOnly,reason)`;

// An opened file also needs what the viewer shows, the conflict check
// compares, and whether it is in the trash.
const FILE_FIELDS = `${ITEM_FIELDS},modifiedTime,lastModifyingUser(displayName),md5Checksum,headRevisionId,trashed`;

const UNREACHABLE = "Google Drive could not be reached";

/** The alias of My Drive's top folder in Drive's API. */
export const MY_DRIVE = "root";

export const FOLDER = "application/vnd.google-apps.folder";
export const SHORTCUT = "application/vnd.google-apps.shortcut";
/** Google's own types (Docs, folders, shortcuts...) have no content to edit. */
export const GOOGLE_TYPES = "application/vnd.google-apps.";
const WITH_CONTENT = `not mimeType contains '${GOOGLE_TYPES}'`;

// Drive also answers 403, rather than 429, when requests come too fast.
const RATE_LIMITS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

export class DriveError extends Error {
  override readonly name = "DriveError";
  /** The HTTP status, or 0 when Drive could not be reached. */
  readonly status: number;
  /** Drive refused because requests came too fast: it may pass later. */
  readonly rateLimited: boolean;

  /** `reason` is the first reason Drive gave, when it gave one. */
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.status = status;
    this.rateLimited =
      status === 429 || (reason !== undefined && RATE_LIMITS.has(reason));
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

export interface ShortcutTarget {
  id: string;
  /** The target's type when the shortcut was made. */
  mimeType: string;
  resourceKey: string | undefined;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  resourceKey: string | undefined;
  parents: string[];
  /** The shared drive the item is in, if any. */
  driveId: string | undefined;
  /** Where a shortcut points: open and list the target, never the shortcut. */
  target: ShortcutTarget | undefined;
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
  /** In the trash, from which Drive can restore it. */
  trashed: boolean;
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
  getContent: (file: FileMetadata) => Promise<Uint8Array<ArrayBuffer>>;
  /** Everything in the folder that is not in the trash, from every page. */
  listChildren: (folder: FileRef) => Promise<DriveItem[]>;
  /** The shared drives the user is a member of. */
  listSharedDrives: () => Promise<SharedDrive[]>;
  /** What is shared with the user, but Google's own documents. */
  listSharedWithMe: () => Promise<DriveItem[]>;
  /** The Markdown files the user viewed last, newest first. */
  listRecent: () => Promise<DriveItem[]>;
  /** Markdown files whose name has a word starting with each word of `text`. */
  search: (text: string) => Promise<DriveItem[]>;
  /** The folders that hold an Obsidian vault, in every drive. */
  findVaults: () => Promise<DriveItem[]>;
  /** The shortcuts the user made outside shared drives, wherever they are. */
  listShortcuts: () => Promise<DriveItem[]>;
  /**
   * Why a shortcut cannot be followed: its target is "missing" when it was
   * deleted or is not shared with the user, or "trashed"; undefined when the
   * target opens.
   */
  checkShortcut: (
    target: ShortcutTarget,
  ) => Promise<"missing" | "trashed" | undefined>;
  /**
   * Replaces the file's content with `content`, uploaded with the file's own
   * MIME type, and reads the new revision's metadata. Drive cannot write on
   * a condition: compare the checksum with fresh metadata just before. After
   * a 401, it forgets the token and fails rather than retry: check again once
   * a new token has come, then save.
   */
  saveContent: (
    file: FileMetadata,
    content: Uint8Array<ArrayBuffer>,
  ) => Promise<FileMetadata>;
  /** Keeps a revision forever, out of Drive's cleanup of old revisions. */
  keepRevision: (file: FileRef, revisionId: string) => Promise<void>;
  /** Marks the file as viewed now, which is what Recent sorts by. */
  markViewed: (file: FileRef) => Promise<void>;
  /**
   * Creates an empty Markdown file in the folder, named `name` with .md added
   * unless it already ends in .md or .markdown.
   */
  createFile: (folder: FileRef, name: string) => Promise<DriveItem>;
  renameFile: (file: FileRef, name: string) => Promise<DriveItem>;
  /** Moves the file out of the folders it is in, into `to`. */
  moveFile: (file: DriveItem, to: FileRef) => Promise<DriveItem>;
  /** Moves the file to the trash, from which Drive can restore it. */
  trashFile: (file: FileRef) => Promise<void>;
}

/** What a call writes: its method, and a body of the given type. */
interface Change {
  method: "PATCH" | "POST";
  type: string;
  body: string | Uint8Array<ArrayBuffer>;
  /**
   * The write rests on a check made just before it, which a new token could
   * outdate: it may take a tap on Continue to come, so a 401 is not retried.
   */
  checked?: true;
}

/** Whether a name marks a Markdown file: MIME types are unreliable. */
export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
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
  /** Calls Drive; after a 401, retries once with a new token, if it may. */
  async function send(
    url: string,
    files: FileRef[],
    change?: Change,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const keys = files.flatMap(({ id, resourceKey }) =>
      resourceKey ? [`${id}/${resourceKey}`] : [],
    );
    if (keys.length > 0) headers["X-Goog-Drive-Resource-Keys"] = keys.join(",");
    if (change) headers["Content-Type"] = change.type;
    const init = change ? { method: change.method, body: change.body } : {};
    const attempt = async () => {
      const token = await auth.token();
      const response = await reach(url, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) auth.forget(token);
      return response;
    };
    const response = await attempt();
    if (response.status !== 401 || change?.checked) return response;
    return attempt();
  }

  /** Follows nextPageToken until Drive has sent every page of `key`. */
  async function list<T>(
    path: string,
    params: Record<string, string>,
    files: FileRef[],
    key: string,
    read: (entry: Record<string, unknown>) => T | undefined,
  ): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams(params);
      if (pageToken !== undefined) query.set("pageToken", pageToken);
      const page = await parse(
        await send(`${API}/${path}?${query.toString()}`, files),
        (body) => readPage(body, key, read),
      );
      items.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return items;
  }

  /** The items matching the query in `params.q`, in any drive. */
  function listFiles(
    params: Record<string, string>,
    files: FileRef[] = [],
  ): Promise<DriveItem[]> {
    const query = {
      pageSize: "1000",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      ...params,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };
    return list("files", query, files, "files", parseItem);
  }

  /** The Markdown files among the first 100 matches of `q`, in every drive. */
  async function findMarkdown(q: string, orderBy: string) {
    const items = await listFiles({
      q: `${q} and trashed = false and ${WITH_CONTENT}`,
      orderBy,
      corpora: "allDrives",
      pageSize: "100",
      // Without nextPageToken, Drive sends the first page only.
      fields: `files(${ITEM_FIELDS})`,
    });
    return items.filter((item) => isMarkdown(item.name));
  }

  async function getMetadata(file: FileRef): Promise<FileMetadata> {
    const response = await send(fileUrl(file, { fields: FILE_FIELDS }), [file]);
    return parse(response, parseFile);
  }

  return {
    getMetadata,
    async getContent(file) {
      const response = await send(fileUrl(file, { alt: "media" }), [file]);
      await confirm(response);
      const content = await response.arrayBuffer().catch(() => {
        throw new DriveError(0, UNREACHABLE);
      });
      return new Uint8Array(content);
    },
    async listChildren(folder) {
      const q = `'${checked(folder.id)}' in parents and trashed = false`;
      return listFiles({ q }, [folder]);
    },
    async listSharedDrives() {
      // As in Drive, the drives the user hid stay out of the list.
      const params = {
        q: "hidden = false",
        fields: "nextPageToken,drives(id,name)",
        pageSize: "100",
      };
      return list("drives", params, [], "drives", parseSharedDrive);
    },
    async listSharedWithMe() {
      const types = `mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}' or ${WITH_CONTENT}`;
      return listFiles({
        q: `sharedWithMe and trashed = false and (${types})`,
      });
    },
    async listRecent() {
      return findMarkdown(
        "viewedByMeTime > '1970-01-01T00:00:00'",
        "viewedByMeTime desc",
      );
    },
    async search(text) {
      const words = text.split(/\s+/).filter((word) => word !== "");
      if (words.length === 0) return [];
      const terms = words.map((word) => `name contains ${quoted(word)}`);
      return findMarkdown(terms.join(" and "), "modifiedTime desc");
    },
    async findVaults() {
      // A vault is a folder that holds an .obsidian folder.
      const configs = await listFiles({
        q: `name = '.obsidian' and mimeType = '${FOLDER}' and trashed = false`,
        corpora: "allDrives",
      });
      const roots = new Set(configs.flatMap(({ parents }) => parents));
      const vaults = await Promise.all(
        [...roots].map((id) => getMetadata({ id }).catch(outOfReach)),
      );
      return vaults.filter((vault) => vault !== undefined);
    },
    async listShortcuts() {
      // Shortcuts in shared drives have no owner: the whole team makes them.
      return listFiles({
        q: `mimeType = '${SHORTCUT}' and 'me' in owners and trashed = false`,
      });
    },
    async checkShortcut(target) {
      try {
        const response = await send(fileUrl(target, { fields: "trashed" }), [
          target,
        ]);
        const trashed = await parse(response, (body) =>
          isRecord(body) ? body.trashed === true : undefined,
        );
        return trashed ? "trashed" : undefined;
      } catch (error) {
        if (notFound(error)) return "missing";
        throw error;
      }
    },
    async saveContent(file, content) {
      const params = { uploadType: "media", fields: FILE_FIELDS };
      const change: Change = {
        method: "PATCH",
        type: file.mimeType,
        body: content,
        checked: true,
      };
      const response = await send(
        fileUrl(file, params, UPLOAD),
        [file],
        change,
      );
      return parse(response, parseFile);
    },
    async keepRevision(file, revisionId) {
      // The revisions calls take no supportsAllDrives: they work in any drive.
      const revision = checked(revisionId);
      const url = `${API}/files/${checked(file.id)}/revisions/${revision}?fields=id`;
      const response = await send(url, [file], json({ keepForever: true }));
      await confirm(response);
    },
    async createFile(folder, name) {
      const trimmed = named(name);
      const file = {
        name: isMarkdown(trimmed) ? trimmed : `${trimmed}.md`,
        parents: [checked(folder.id)],
        mimeType: "text/markdown",
      };
      const url = `${API}/files?${inAnyDrive({ fields: ITEM_FIELDS })}`;
      return parse(await send(url, [folder], json(file, "POST")), readItem);
    },
    async renameFile(file, name) {
      const change = json({ name: named(name) });
      const url = fileUrl(file, { fields: ITEM_FIELDS });
      return parse(await send(url, [file], change), readItem);
    },
    async moveFile(file, to) {
      if (file.parents.includes(to.id)) return file;
      const url = fileUrl(file, {
        addParents: checked(to.id),
        removeParents: file.parents.map(checked).join(","),
        fields: ITEM_FIELDS,
      });
      return parse(await send(url, [file, to], json({})), readItem);
    },
    async trashFile(file) {
      const url = fileUrl(file, { fields: "id" });
      await confirm(await send(url, [file], json({ trashed: true })));
    },
    async markViewed(file) {
      const viewed = { viewedByMeTime: new Date().toISOString() };
      const response = await send(
        fileUrl(file, { fields: "id" }),
        [file],
        json(viewed),
      );
      await confirm(response);
    },
  };
}

/** A change that sends `value` as JSON: new fields for the item, by default. */
function json(value: object, method: Change["method"] = "PATCH"): Change {
  return {
    method,
    type: "application/json",
    body: JSON.stringify(value),
  };
}

/**
 * Leaves out an item Drive says is not there for the user; any other failure
 * stands.
 */
export function outOfReach(error: unknown): undefined {
  if (notFound(error)) return;
  throw error;
}

/**
 * Whether Drive answered that the item is not there: deleted, or not shared
 * with the user. Drive also answers 403 when it limits the rate, so a 403
 * says nothing about the item.
 */
function notFound(error: unknown): boolean {
  return error instanceof DriveError && error.status === 404;
}

/** A string literal in a Drive query. */
function quoted(value: string): string {
  return `'${value.replace(/[\\']/g, "\\$&")}'`;
}

interface Page<T> {
  items: T[];
  nextPageToken: string | undefined;
}

/** A URL for one file, in any drive. */
function fileUrl(
  file: FileRef,
  params: Record<string, string>,
  base = API,
): string {
  return `${base}/files/${checked(file.id)}?${inAnyDrive(params)}`;
}

/** The query of a call on files, which works in every drive. */
function inAnyDrive(params: Record<string, string>): string {
  return new URLSearchParams({
    ...params,
    supportsAllDrives: "true",
  }).toString();
}

/**
 * The name without the spaces around it, which a phone keyboard often adds;
 * refused when blank, since the app never makes a nameless file.
 */
function named(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new DriveError(400, "A file needs a name");
  return trimmed;
}

/**
 * Whether a value is shaped like a Drive ID or resource key: letters, digits,
 * "-" and "_". Any other character could reach another endpoint or change a
 * query, and "." or ".." in a path would be resolved away.
 */
export function isDriveId(value: string): boolean {
  return /^[\w-]+$/.test(value);
}

/** The ID, once it is known to be shaped like a Drive ID. */
function checked(id: string): string {
  if (!isDriveId(id)) throw new DriveError(400, "Not a Drive ID");
  return id;
}

// The token only ever travels in the Authorization header, and no error
// message quotes the request. Answers skip the HTTP cache, so that a conflict
// check never reads a stale checksum, and no file outlives the session there.
function reach(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store" }).catch(() => {
    throw new DriveError(0, UNREACHABLE);
  });
}

/** Rejects unless Drive accepted the call. */
async function confirm(response: Response): Promise<void> {
  if (!response.ok) throw await refusal(response);
}

async function refusal(response: Response): Promise<DriveError> {
  const body: unknown = await response.json().catch(() => undefined);
  return new DriveError(
    response.status,
    errorMessage(body) ?? `Google Drive answered ${String(response.status)}`,
    errorReason(body),
  );
}

async function parse<T>(
  response: Response,
  read: (body: unknown) => T | undefined,
): Promise<T> {
  await confirm(response);
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

function errorReason(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  const errors = isRecord(error) ? error.errors : undefined;
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  return isRecord(first) ? optionalString(first.reason) : undefined;
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
    target: parseTarget(value.shortcutDetails),
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

function parseTarget(details: unknown): ShortcutTarget | undefined {
  if (!isRecord(details)) return;
  const id = optionalString(details.targetId);
  const mimeType = optionalString(details.targetMimeType);
  if (id === undefined || mimeType === undefined) return;
  return {
    id,
    mimeType,
    resourceKey: optionalString(details.targetResourceKey),
  };
}

function readItem(body: unknown): DriveItem | undefined {
  return isRecord(body) ? parseItem(body) : undefined;
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
    trashed: value.trashed === true,
  };
}

function readPage<T>(
  body: unknown,
  key: string,
  read: (value: Record<string, unknown>) => T | undefined,
): Page<T> | undefined {
  if (!isRecord(body)) return;
  // Drive may leave out an empty list.
  const entries: unknown = body[key] ?? [];
  if (!Array.isArray(entries)) return;
  // One entry Drive sent oddly is skipped rather than hiding all the others.
  const items = entries.flatMap((entry: unknown) => {
    const item = isRecord(entry) ? read(entry) : undefined;
    return item === undefined ? [] : [item];
  });
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
