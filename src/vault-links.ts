import {
  GOOGLE_TYPES,
  type DriveItem,
  type FileMetadata,
  type FileRef,
  type SearchResult,
} from "./drive.ts";
import { resolve, type FolderReader, type Found } from "./resolve.ts";

/** How a link in a vault reads Drive. */
export interface VaultReader extends FolderReader {
  /** The files with content of that name in every drive, whatever its case. */
  named: (name: string) => Promise<SearchResult>;
  /** The folders an item sits in, the topmost first, as far as the user reaches. */
  folders: (item: FileRef) => Promise<FileMetadata[]>;
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
 * What a link in a note of a vault leads to, as Obsidian resolves it. A name
 * alone is looked up in the note's folder, then anywhere in the vault, where
 * the shortest path wins. A path is read from the note's folder, then from
 * the vault's, then as the end of a file's path anywhere in the vault. A
 * name without an extension is a note's, with `.md`.
 */
export async function resolveInVault(
  path: string[],
  { vault, folder }: { vault: FileRef; folder: FileRef },
  read: VaultReader,
): Promise<VaultLink> {
  const name = path.at(-1);
  if (!name) return { found: undefined, incomplete: false };
  const above = path.slice(0, -1);
  let incomplete = false;
  for (const candidate of fileNames(name)) {
    const steps = [...above, candidate];
    const found =
      above.length > 0
        ? ((await resolve(folder, steps, read, same)) ??
          (await resolve(vault, steps, read, same)))
        : await inFolder(folder, candidate, read);
    if (found) return { found, incomplete: false };
    const searched = await anywhere(vault, steps, read);
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

/** A file of that name in the folder. */
async function inFolder(
  folder: FileRef,
  name: string,
  read: VaultReader,
): Promise<Found | undefined> {
  const item = (await read.children(folder)).find(
    (child) => hasContent(child) && same(child.name, name),
  );
  return item && foundOf(item);
}

/**
 * The file of that name with the shortest path in the vault, whose folders
 * end as the steps before its name do.
 */
async function anywhere(
  vault: FileRef,
  steps: string[],
  read: VaultReader,
): Promise<VaultLink> {
  const above = steps.slice(0, -1);
  const { items, incomplete } = await read.named(steps.at(-1) ?? "");
  let best: { item: DriveItem; depth: number } | undefined;
  for (const item of items.filter(hasContent)) {
    const folders = await read.folders(item);
    const top = folders.findIndex(({ id }) => id === vault.id);
    if (top < 0) continue;
    const within = folders.slice(top + 1).map(({ name }) => name);
    const ends = above.every((step, index) =>
      same(within.at(index - above.length) ?? "", step),
    );
    if (ends && within.length >= above.length) {
      if (!best || within.length < best.depth) {
        best = { item, depth: within.length };
      }
    }
  }
  return best
    ? { found: foundOf(best.item), incomplete: false }
    : { found: undefined, incomplete };
}

/** Whether an item is a file with content, rather than a folder or shortcut. */
function hasContent({ mimeType }: DriveItem): boolean {
  return !mimeType.startsWith(GOOGLE_TYPES);
}

function foundOf({ id, resourceKey, name, mimeType }: DriveItem): Found {
  return { ref: { id, resourceKey }, name, mimeType };
}
