import {
  FOLDER,
  GOOGLE_TYPES,
  type DriveItem,
  type FileRef,
  type SearchResult,
} from "./drive.ts";
import { resolve, type FolderReader, type Found } from "./resolve.ts";

/** How a link in a vault reads Drive. */
export interface VaultReader extends FolderReader {
  /** The files with content of that name in every drive, whatever its case. */
  named: (name: string) => Promise<SearchResult>;
  /**
   * The vault's folders, but those whose name starts with a dot, as Obsidian
   * leaves them out: each one's path from the vault's, which has none.
   */
  folders: () => Promise<Map<string, string[]>>;
}

/**
 * What a link in a vault leads to, if anything, and whether Drive left some
 * drives out of a search that found nothing.
 */
export interface VaultLink {
  found: Found | undefined;
  incomplete: boolean;
}

/** Names compare as Obsidian compares them, whatever their case. */
function same(name: string, other: string): boolean {
  return name.toLowerCase() === other.toLowerCase();
}

/**
 * What a link in a note of a vault leads to, as Obsidian resolves it: a file
 * with content in the vault, never a folder, a shortcut or one of Google's
 * documents. A name alone is looked up in the note's folder, then anywhere
 * in the vault, where the shortest path wins. A path is read from the note's
 * folder, then from the vault's, then as the end of a file's path anywhere
 * in the vault. A name without an extension is a note's, with `.md`.
 */
export async function resolveInVault(
  path: string[],
  { vault, folder }: { vault: FileRef; folder: FileRef },
  read: VaultReader,
): Promise<VaultLink> {
  const name = path.at(-1);
  if (!name) return { found: undefined, incomplete: false };
  const above = path.slice(0, -1);
  const names = fileNames(name);
  // What lies near the note first, as written then as a note's name.
  const starts = above.length === 0 ? [folder] : [folder, vault];
  for (const start of starts) {
    const where = await folderAt(start, above, vault, read);
    if (!where) continue;
    for (const candidate of names) {
      const found = await inFolder(where, candidate, read);
      if (found) return { found, incomplete: false };
    }
  }
  let incomplete = false;
  for (const candidate of names) {
    const searched = await anywhere(above, candidate, read);
    if (searched.found) return searched;
    incomplete ||= searched.incomplete;
  }
  return { found: undefined, incomplete };
}

/**
 * The names a link's last step may stand for: a note's, with `.md` added when
 * it has no extension, or the file's as written when it may have one.
 */
function fileNames(name: string): string[] {
  if (/\.md$/i.test(name)) return [name];
  return name.includes(".") ? [name, `${name}.md`] : [`${name}.md`];
}

/** The folder a path leads to from another, if it is one in the vault. */
async function folderAt(
  start: FileRef,
  path: string[],
  vault: FileRef,
  read: VaultReader,
): Promise<FileRef | undefined> {
  if (path.length === 0) return start;
  const found = await resolve(start, path, read, same);
  if (found?.mimeType !== FOLDER) return;
  const inVault =
    found.ref.id === vault.id || (await read.folders()).has(found.ref.id);
  return inVault ? found.ref : undefined;
}

/** A file of that name in the folder, the one written in the same case first. */
async function inFolder(
  folder: FileRef,
  name: string,
  read: VaultReader,
): Promise<Found | undefined> {
  const files = (await read.children(folder)).filter(
    (child) => hasContent(child) && same(child.name, name),
  );
  const item = files.find((file) => file.name === name) ?? files[0];
  return item && foundOf(item);
}

/**
 * The file of that name anywhere in the vault whose folders end as the steps
 * before its name do: the one with the shortest path, then the one written
 * in the same case, then the first by path, whatever order Drive answers in.
 */
async function anywhere(
  above: string[],
  name: string,
  read: VaultReader,
): Promise<VaultLink> {
  const { items, incomplete } = await read.named(name);
  const folders = await read.folders();
  let best: { item: DriveItem; rank: [number, number, string] } | undefined;
  for (const item of items) {
    const within = folders.get(item.parents[0] ?? "");
    if (!within || !hasContent(item) || !same(item.name, name)) continue;
    const ends =
      within.length >= above.length &&
      above.every((step, index) =>
        same(within[within.length - above.length + index] ?? "", step),
      );
    if (!ends) continue;
    const rank: [number, number, string] = [
      within.length,
      item.name === name ? 0 : 1,
      [...within, item.name].join("/").toLowerCase(),
    ];
    if (!best || before(rank, best.rank)) best = { item, rank };
  }
  return best
    ? { found: foundOf(best.item), incomplete: false }
    : { found: undefined, incomplete };
}

function before(
  [depth, cased, path]: [number, number, string],
  [otherDepth, otherCased, otherPath]: [number, number, string],
): boolean {
  if (depth !== otherDepth) return depth < otherDepth;
  if (cased !== otherCased) return cased < otherCased;
  return path < otherPath;
}

/** Whether an item is a file with content, rather than a folder or shortcut. */
function hasContent({ mimeType }: DriveItem): boolean {
  return !mimeType.startsWith(GOOGLE_TYPES);
}

function foundOf({ id, resourceKey, name, mimeType }: DriveItem): Found {
  return { ref: { id, resourceKey }, name, mimeType };
}
