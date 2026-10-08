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

// What the navigator shows, when and by whom an item last changed among it,
// where shortcuts point, and the actions it offers.
const ITEM_FIELDS =
  "id,name,mimeType,resourceKey,parents,driveId," +
  "shortcutDetails(targetId,targetMimeType,targetResourceKey)," +
  `capabilities(${CAPABILITIES.join(",")}),contentRestrictions(readOnly,reason),` +
  "modifiedTime,lastModifyingUser(displayName,me)";

// An opened file also needs what the conflict check compares, its size
// before its content is read, and whether it is in the trash.
const FILE_FIELDS = `${ITEM_FIELDS},md5Checksum,headRevisionId,size,trashed`;

/** What a Drive call says when it cannot reach Drive. */
export const UNREACHABLE = "Google Drive could not be reached";

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

/** A file holds more bytes than the caller would read. */
export class TooLargeError extends Error {
  override readonly name = "TooLargeError";
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
  modifiedTime: string | undefined;
  /** Who changed the item last, when a signed-in user did. */
  lastModifiedBy: string | undefined;
  /** Whether the signed-in user did. */
  lastModifiedByMe: boolean;
}

export interface FileMetadata extends DriveItem {
  /** Compared before saving, to detect someone else's change. */
  md5Checksum: string | undefined;
  headRevisionId: string | undefined;
  /** The content's size in bytes, which Google's own types do not have. */
  size: number | undefined;
  /** In the trash, from which Drive can restore it. */
  trashed: boolean;
}

/** What a search found, and whether Drive says it left some drives out. */
export interface SearchResult {
  items: DriveItem[];
  incomplete: boolean;
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
   * overwrite someone else's change. Rejects with a TooLargeError, without
   * reading further, once the bytes pass `limit`: the file may have grown
   * since its metadata gave its size.
   */
  getContent: (
    file: FileMetadata,
    limit: number,
  ) => Promise<Uint8Array<ArrayBuffer>>;
  /** Everything in the folder that is not in the trash, from every page. */
  listChildren: (folder: FileRef) => Promise<DriveItem[]>;
  /** The shared drives the user is a member of. */
  listSharedDrives: () => Promise<SharedDrive[]>;
  /** What is shared with the user, but Google's own documents. */
  listSharedWithMe: () => Promise<DriveItem[]>;
  /** The Markdown files the user viewed last, newest first. */
  listRecent: () => Promise<DriveItem[]>;
  /** Markdown files whose name has a word starting with each word of `text`. */
  search: (text: string) => Promise<SearchResult>;
  /**
   * The files with content named `name`, whatever its case in ASCII letters,
   * and as written, in small letters, capitals or capital initials in others.
   */
  findByName: (name: string) => Promise<SearchResult>;
  /** The folders that hold an Obsidian vault, in every drive. */
  findVaults: () => Promise<DriveItem[]>;
  /**
   * The `.obsidian` folders in every drive, each in the folder of its vault:
   * one search, where findVaults also reads each vault's folder.
   */
  findVaultConfigs: () => Promise<DriveItem[]>;
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

/** The ending of a Markdown file's name. */
const MARKDOWN_ENDING = /\.(md|markdown)$/i;

/** Whether a name marks a Markdown file: MIME types are unreliable. */
export function isMarkdown(name: string): boolean {
  return MARKDOWN_ENDING.test(name);
}

/** A name apart from its Markdown ending, which is empty if it has none. */
export function splitEnding(name: string): [string, string] {
  const at = MARKDOWN_ENDING.exec(name)?.index ?? name.length;
  return [name.slice(0, at), name.slice(at)];
}

/** Whether Drive lets the user move the file, within its drive or out. */
export function mayMove({ capabilities }: FileMetadata): boolean {
  return (
    capabilities.canMoveItemWithinDrive || capabilities.canMoveItemOutOfDrive
  );
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

  /**
   * Follows nextPageToken until Drive has sent every page of `key`, and says
   * whether any page left some drives out of a search. A page Drive sends
   * twice fails the list, which would never end.
   */
  async function list<T>(
    path: string,
    params: Record<string, string>,
    files: FileRef[],
    key: string,
    read: (entry: Record<string, unknown>) => T | undefined,
  ): Promise<{ items: T[]; incomplete: boolean }> {
    const items: T[] = [];
    const seen = new Set<string>();
    let incomplete = false;
    let pageToken: string | undefined;
    do {
      if (pageToken !== undefined) {
        if (seen.has(pageToken)) {
          throw new DriveError(502, "Google Drive sent the same page twice");
        }
        seen.add(pageToken);
      }
      const query = new URLSearchParams(params);
      if (pageToken !== undefined) query.set("pageToken", pageToken);
      const page = await parse(
        await send(`${API}/${path}?${query.toString()}`, files),
        (body) => readPage(body, key, read),
      );
      items.push(...page.items);
      incomplete ||= page.incomplete;
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
    return { items, incomplete };
  }

  /** The items matching the query in `params.q`, in any drive. */
  function searchFiles(
    params: Record<string, string>,
    files: FileRef[] = [],
  ): Promise<SearchResult> {
    const query = {
      pageSize: "1000",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      ...params,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };
    return list("files", query, files, "files", parseItem);
  }

  async function listFiles(
    params: Record<string, string>,
    files: FileRef[] = [],
  ): Promise<DriveItem[]> {
    return (await searchFiles(params, files)).items;
  }

  /** The Markdown files among the first 100 matches of `q`, in every drive. */
  async function findMarkdown(q: string, orderBy: string) {
    const { items, incomplete } = await searchFiles({
      q: `${q} and trashed = false and ${WITH_CONTENT}`,
      orderBy,
      corpora: "allDrives",
      pageSize: "100",
      // Without nextPageToken, Drive sends the first page only.
      fields: `incompleteSearch,files(${ITEM_FIELDS})`,
    });
    return { items: items.filter((item) => isMarkdown(item.name)), incomplete };
  }

  function findVaultConfigs(): Promise<DriveItem[]> {
    return listFiles({
      q: `name = '.obsidian' and mimeType = '${FOLDER}' and trashed = false`,
      corpora: "allDrives",
    });
  }

  async function getMetadata(file: FileRef): Promise<FileMetadata> {
    const response = await send(fileUrl(file, { fields: FILE_FIELDS }), [file]);
    return parse(response, parseFile);
  }

  return {
    getMetadata,
    async getContent(file, limit) {
      const response = await send(fileUrl(file, { alt: "media" }), [file]);
      await confirm(response);
      return readUpTo(response, limit);
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
      const drives = await list(
        "drives",
        params,
        [],
        "drives",
        parseSharedDrive,
      );
      return drives.items;
    },
    async listSharedWithMe() {
      const types = `mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}' or ${WITH_CONTENT}`;
      return listFiles({
        q: `sharedWithMe and trashed = false and (${types})`,
      });
    },
    async listRecent() {
      const recent = await findMarkdown(
        "viewedByMeTime > '1970-01-01T00:00:00'",
        "viewedByMeTime desc",
      );
      return recent.items;
    },
    async search(text) {
      const words = text.split(/\s+/).filter((word) => word !== "");
      if (words.length === 0) return { items: [], incomplete: false };
      const terms = words.map((word) => `name contains ${quoted(word)}`);
      return findMarkdown(terms.join(" and "), "modifiedTime desc");
    },
    async findByName(name) {
      if (name === "") return { items: [], incomplete: false };
      const names = caseVariants(name).map(
        (variant) => `name = ${quoted(variant)}`,
      );
      const either =
        names.length > 1 ? `(${names.join(" or ")})` : names.join("");
      return searchFiles({
        q: `${either} and trashed = false and ${WITH_CONTENT}`,
        corpora: "allDrives",
        fields: `nextPageToken,incompleteSearch,files(${ITEM_FIELDS})`,
      });
    },
    findVaultConfigs,
    async findVaults() {
      // A vault is a folder that holds an .obsidian folder.
      const configs = await findVaultConfigs();
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
export function notFound(error: unknown): boolean {
  return error instanceof DriveError && error.status === 404;
}

/**
 * A name as written, in small letters, in capitals, with a capital first and
 * with each word's: Drive matches a name whatever the case of its ASCII
 * letters only, so `été` would not find `Été`. Variants that differ only in
 * ASCII letters are one.
 */
function caseVariants(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(
      /(^|\s)(\S)/gu,
      (_, space: string, first: string) => space + first.toUpperCase(),
    );
  const variants = [
    name,
    name.toLowerCase(),
    name.toUpperCase(),
    name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
    words,
  ];
  const folded = (variant: string) =>
    variant.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return variants.filter(
    (variant, index) =>
      variants.findIndex((other) => folded(other) === folded(variant)) ===
      index,
  );
}

/** A string literal in a Drive query. */
function quoted(value: string): string {
  return `'${value.replace(/[\\']/g, "\\$&")}'`;
}

interface Page<T> {
  items: T[];
  nextPageToken: string | undefined;
  /** Drive left some drives out of the search. */
  incomplete: boolean;
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

/** A response's bytes, read no further than `limit`. */
async function readUpTo(
  response: Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const next = () =>
    reader.read().catch(() => {
      throw new DriveError(0, UNREACHABLE);
    });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await next(); !chunk.done; chunk = await next()) {
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new TooLargeError(
        `The file holds more than ${String(limit)} bytes`,
      );
    }
    chunks.push(chunk.value);
  }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  return content;
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
  const user = isRecord(value.lastModifyingUser) ? value.lastModifyingUser : {};
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
    modifiedTime: optionalString(value.modifiedTime),
    lastModifiedBy: optionalString(user.displayName),
    lastModifiedByMe: user.me === true,
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
  return {
    ...item,
    md5Checksum: optionalString(value.md5Checksum),
    headRevisionId: optionalString(value.headRevisionId),
    size: parseSize(value.size),
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
  return {
    items,
    nextPageToken: optionalString(body.nextPageToken),
    incomplete: body.incompleteSearch === true,
  };
}

function parseSharedDrive(
  value: Record<string, unknown>,
): SharedDrive | undefined {
  const { id, name } = value;
  if (typeof id !== "string" || typeof name !== "string") return;
  return { id, name };
}

/** Drive sends 64-bit numbers as strings. */
function parseSize(value: unknown): number | undefined {
  return typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
