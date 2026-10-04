import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { climb } from "./climb.ts";
import { readDraft } from "./drafts.ts";
import { pool } from "./pool.ts";
import { resolve, type FolderReader } from "./resolve.ts";
import { resolveInVault } from "./vault-links.ts";
import {
  DEFAULT_SETTINGS,
  readSettings,
  type VaultSettings,
} from "./vault-settings.ts";
import {
  DriveError,
  GOOGLE_TYPES,
  TooLargeError,
  type Drive,
  type FileMetadata,
  type FileRef,
  type ShortcutTarget,
} from "./drive.ts";

// Vaults seldom come and go, and finding them takes a call per vault.
const VAULTS_STALE_TIME = 5 * 60_000;

/**
 * A cache for Drive's answers. Create one per signed-in account, so that
 * another account never sees them.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // A page opened again within half a minute shows what it had, without
      // asking Drive again.
      queries: { retry: mayPassLater, staleTime: 30_000 },
    },
  });
}

// Each Drive call has its key here, so that every page, the folder picker
// and the viewer share Drive's answers.

/** A key for Drive's answers: the call, then what it is about. */
function key(...parts: (string | undefined)[]) {
  return parts;
}

/** An item's details; none while there is no item to ask about. */
export function metadataQuery(drive: Drive, item: FileRef | undefined) {
  return queryOptions({
    queryKey: key("metadata", item?.id, item?.resourceKey),
    queryFn: item ? () => drive.getMetadata(item) : skipToken,
  });
}

export function childrenQuery(drive: Drive, folder: FileRef) {
  return queryOptions({
    queryKey: key("children", folder.id, folder.resourceKey),
    queryFn: () => drive.listChildren(folder),
  });
}

export function shortcutsQuery(drive: Drive) {
  return queryOptions({
    queryKey: key("shortcuts"),
    queryFn: drive.listShortcuts,
  });
}

export function sharedWithMeQuery(drive: Drive) {
  return queryOptions({
    queryKey: key("shared-with-me"),
    queryFn: drive.listSharedWithMe,
  });
}

export function sharedDrivesQuery(drive: Drive) {
  return queryOptions({
    queryKey: key("shared-drives"),
    queryFn: drive.listSharedDrives,
  });
}

export function recentQuery(drive: Drive) {
  return queryOptions({ queryKey: key("recent"), queryFn: drive.listRecent });
}

export function vaultsQuery(drive: Drive) {
  return queryOptions({
    queryKey: key("vaults"),
    queryFn: drive.findVaults,
    staleTime: VAULTS_STALE_TIME,
  });
}

/** Where the vaults are: one search, which reads no vault's folder. */
export function vaultConfigsQuery(drive: Drive) {
  return queryOptions({
    queryKey: key("vault-configs"),
    queryFn: drive.findVaultConfigs,
    staleTime: VAULTS_STALE_TIME,
  });
}

/** Larger settings files are not read: Obsidian's holds a few hundred bytes. */
const MAX_SETTINGS = 100_000;

/**
 * The settings of a vault, from the `app.json` in its `.obsidian` folder,
 * read through the cache the pages share; none while there is no vault.
 */
export function vaultSettingsQuery(
  drive: Drive,
  client: QueryClient,
  config: FileRef | undefined,
) {
  return queryOptions({
    queryKey: key("vault-settings", config?.id, config?.resourceKey),
    queryFn: config
      ? async (): Promise<VaultSettings> => {
          // The settings as a whole are tried again.
          const file = (
            await client.query({
              ...childrenQuery(drive, config),
              retry: false,
            })
          ).find(
            ({ name, mimeType }) =>
              name === "app.json" && !mimeType.startsWith(GOOGLE_TYPES),
          );
          if (!file) return DEFAULT_SETTINGS;
          const details = await client.query({
            ...metadataQuery(drive, file),
            retry: false,
          });
          try {
            return readSettings(await drive.getContent(details, MAX_SETTINGS));
          } catch (error) {
            if (error instanceof TooLargeError) return DEFAULT_SETTINGS;
            throw error;
          }
        }
      : skipToken,
    staleTime: VAULTS_STALE_TIME,
  });
}

export function searchQuery(drive: Drive, text: string) {
  return queryOptions({
    queryKey: key("search", text),
    queryFn: () => drive.search(text),
  });
}

/**
 * Larger notes are not read: rendering them would stall a phone. 1 MB is far
 * more than a note holds.
 */
export const MAX_CONTENT = 1_000_000;

/** Larger images are not read: a photo from a phone holds a few MB. */
export const MAX_IMAGE = 10_000_000;

// The links and images of a note ask Drive a few at a time, however many of
// them come near the screen together.
const lookups = pool(4);

/**
 * A file's bytes, from the revision its details name on. Drive sends the
 * bytes it holds when asked, which may be newer than those details but never
 * older: a save that compares them then sees a change that is not one, and
 * never overwrites someone else's.
 */
export function contentQuery(drive: Drive, file: FileMetadata) {
  return queryOptions({
    queryKey: key(
      "content",
      file.id,
      file.resourceKey,
      file.headRevisionId,
      file.md5Checksum,
    ),
    queryFn: () => drive.getContent(file, MAX_CONTENT),
    staleTime: Infinity,
  });
}

/**
 * The bytes of a note an embed shows, as contentQuery reads them, sharing its
 * cache, but a few at a time, as links and images; none while there is no
 * note to read.
 */
export function noteQuery(drive: Drive, file: FileMetadata | undefined) {
  return queryOptions({
    queryKey: key(
      "content",
      file?.id,
      file?.resourceKey,
      file?.headRevisionId,
      file?.md5Checksum,
    ),
    queryFn: file
      ? ({ signal }) =>
          lookups(() => drive.getContent(file, MAX_CONTENT), signal)
      : skipToken,
    staleTime: Infinity,
  });
}

/**
 * An image's bytes, as for a note's content; none while there is no image to
 * read. Images leave the cache soon after their note, as they can be large.
 */
export function imageQuery(drive: Drive, file: FileMetadata | undefined) {
  return queryOptions({
    queryKey: key(
      "image",
      file?.id,
      file?.resourceKey,
      file?.headRevisionId,
      file?.md5Checksum,
    ),
    queryFn: file
      ? ({ signal }) => lookups(() => drive.getContent(file, MAX_IMAGE), signal)
      : skipToken,
    staleTime: Infinity,
    gcTime: 30_000,
  });
}

/**
 * How a link's resolution reads folders, through the cache the pages share.
 * The resolution as a whole is tried again.
 */
function folderReader(drive: Drive, client: QueryClient): FolderReader {
  return {
    children: (folder) =>
      client.query({ ...childrenQuery(drive, folder), retry: false }),
    parent: async (folder) => {
      const details = await client.query({
        ...metadataQuery(drive, folder),
        retry: false,
      });
      return details.parents[0];
    },
  };
}

/**
 * What a relative path in a note leads to from the note's folder, or null,
 * reading folders through the cache that the pages share.
 */
export function resolveQuery(
  drive: Drive,
  client: QueryClient,
  folder: FileRef,
  path: string[],
) {
  return queryOptions({
    queryKey: key("resolve", folder.id, folder.resourceKey, ...path),
    queryFn: async ({ signal }) => {
      const found = await lookups(
        () => resolve(folder, path, folderReader(drive, client)),
        signal,
      );
      return found ?? null;
    },
  });
}

/** The files of a name, which Drive matches whatever its case. */
function nameQuery(drive: Drive, name: string) {
  return queryOptions({
    queryKey: key("name", name),
    queryFn: () => drive.findByName(name),
  });
}

/**
 * The folders of a vault, but those whose name starts with a dot, as Obsidian
 * leaves them out, and each one's path from the vault's: read a level at a
 * time, a call for 50 folders at most, rather than a call for each.
 */
export function vaultFoldersQuery(drive: Drive, vault: FileRef) {
  return queryOptions({
    queryKey: key("vault-folders", vault.id, vault.resourceKey),
    queryFn: async () => {
      const paths = new Map<string, string[]>([[vault.id, []]]);
      let level: FileRef[] = [vault];
      while (level.length > 0) {
        const found = await drive.listFolders(level);
        level = [];
        for (const { id, resourceKey, name, parents } of found) {
          const parent = parents.find((above) => paths.has(above));
          const path = parent === undefined ? undefined : paths.get(parent);
          if (!path || paths.has(id) || name.startsWith(".")) continue;
          paths.set(id, [...path, name]);
          level.push({ id, resourceKey });
        }
      }
      return paths;
    },
    staleTime: VAULTS_STALE_TIME,
  });
}

/**
 * What a link in a note of a vault leads to, from the note's folder, reading
 * Drive through the cache that the pages share.
 */
export function vaultLinkQuery(
  drive: Drive,
  client: QueryClient,
  from: { vault: FileRef; folder: FileRef },
  path: string[],
) {
  const { vault, folder } = from;
  return queryOptions({
    queryKey: key(
      "vault-link",
      vault.id,
      folder.id,
      folder.resourceKey,
      ...path,
    ),
    queryFn: ({ signal }) =>
      lookups(
        () =>
          resolveInVault(path, from, {
            ...folderReader(drive, client),
            named: (name) =>
              client.query({ ...nameQuery(drive, name), retry: false }),
            folders: () =>
              client.query({
                ...vaultFoldersQuery(drive, vault),
                retry: false,
              }),
          }),
        signal,
      ),
  });
}

/** Why a shortcut cannot be followed, or null when its target opens. */
export function shortcutQuery(drive: Drive, target: ShortcutTarget) {
  return queryOptions({
    queryKey: key("shortcut", target.id, target.resourceKey),
    // A query cannot answer undefined.
    queryFn: async () => (await drive.checkShortcut(target)) ?? null,
  });
}

/** An item and the folders above it, each read once through the cache. */
export function climbQuery(drive: Drive, client: QueryClient, item: FileRef) {
  return queryOptions({
    queryKey: key("climb", item.id, item.resourceKey),
    queryFn: () =>
      climb(item, (ref) =>
        client.query({
          ...metadataQuery(drive, ref),
          // The climb as a whole is tried again, reading what came already
          // from the cache.
          retry: false,
        }),
      ),
  });
}

/** The unsaved text the device keeps for a note of the account, or null. */
export function draftQuery(account: string, fileId: string) {
  return queryOptions({
    queryKey: key("draft", account, fileId),
    queryFn: async () => (await readDraft(account, fileId)) ?? null,
    // Read afresh each time the note opens: the page wrote it as it went.
    staleTime: 0,
    gcTime: 0,
    // A device that keeps nothing has nothing to offer.
    retry: false,
  });
}

/**
 * Has Drive asked again for whatever shows a file that was just created,
 * renamed, moved or trashed: lists, searches, Recent, paths, shortcut checks
 * and the links in notes. The file's own details are asked again only if its
 * page stays.
 */
export function refreshAfterChange(
  client: QueryClient,
  file: FileRef,
  { leaving = false } = {},
): void {
  for (const call of [
    "children",
    "search",
    "recent",
    "climb",
    "shortcut",
    "resolve",
    "name",
    "vault-link",
    "vault-folders",
  ]) {
    void client.invalidateQueries({ queryKey: key(call) });
  }
  void client.invalidateQueries({
    queryKey: key("metadata", file.id),
    refetchType: leaving ? "none" : "active",
  });
}

/** Puts the file in its new folders, before Drive's details say so. */
export function setParents(
  client: QueryClient,
  file: FileRef,
  parents: string[],
): void {
  client.setQueriesData<FileMetadata>(
    { queryKey: key("metadata", file.id) },
    (before) => before && { ...before, parents },
  );
}

/** Shows the file's new details at once, as a save answered them. */
export function setDetails(client: QueryClient, file: FileMetadata): void {
  client.setQueriesData<FileMetadata>(
    { queryKey: key("metadata", file.id) },
    file,
  );
}

/** Has the next search ask Drive again, even for the same words. */
export function refreshSearches(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: key("search") });
}

/**
 * Has Recent ask Drive again the next time it shows, once a file was marked
 * viewed.
 */
export function refreshRecent(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    queryKey: key("recent"),
    refetchType: "none",
  });
}

/**
 * Whether a failed call may pass a moment later: without a connection, when
 * Drive limits the rate, or on a server error. Twice at most, so that the
 * user soon sees what went wrong.
 */
function mayPassLater(failures: number, error: Error): boolean {
  if (failures >= 2 || !(error instanceof DriveError)) return false;
  const { status, rateLimited } = error;
  return status === 0 || rateLimited || status >= 500;
}
