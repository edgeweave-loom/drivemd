import { FOLDER, type DriveItem, type FileRef } from "./drive.ts";

/** What a relative link or image in a note leads to in Drive. */
export interface Found {
  /** What opens: a shortcut's target, or the item itself. */
  ref: FileRef;
  /** The name the path gave: a shortcut's own. */
  name: string;
  /** The type of what opens. */
  mimeType: string;
}

/** How resolving reads Drive. */
export interface FolderReader {
  /** The items in a folder, out of the trash. */
  children: (folder: FileRef) => Promise<DriveItem[]>;
  /** The ID of the folder a folder sits in, if it has one. */
  parent: (folder: FileRef) => Promise<string | undefined>;
}

/**
 * The steps of a relative path in a link or an image, decoded, without its
 * query or fragment; undefined for any other address: one with a scheme, one
 * from the top (`/`), or one within the page.
 */
export function relativePath(href: string): string[] | undefined {
  if (href === "" || /^[/?#]/.test(href) || /^[a-z][\w+.-]*:/i.test(href)) {
    return;
  }
  const [path = ""] = href.split(/[?#]/);
  try {
    return path.split("/").map(decodeURIComponent);
  } catch {
    return;
  }
}

/**
 * What a relative path leads to from a folder, as Obsidian and GitHub read
 * it: `..` climbs to the parent, `.` and empty steps stay, and a name must
 * match exactly. Shortcuts lead to their target. Undefined when nothing is
 * there; fails as Drive does for a folder it cannot list.
 */
export async function resolve(
  folder: FileRef,
  path: string[],
  read: FolderReader,
): Promise<Found | undefined> {
  let here: Found = { ref: folder, name: "", mimeType: FOLDER };
  for (const step of path) {
    if (step === "" || step === ".") continue;
    if (here.mimeType !== FOLDER) return;
    if (step === "..") {
      const parent = await read.parent(here.ref);
      if (parent === undefined) return;
      here = { ref: { id: parent }, name: "..", mimeType: FOLDER };
      continue;
    }
    const item = (await read.children(here.ref)).find(
      ({ name }) => name === step,
    );
    if (!item) return;
    const opens = item.target ?? item;
    here = {
      ref: { id: opens.id, resourceKey: opens.resourceKey },
      name: item.name,
      mimeType: opens.mimeType,
    };
  }
  return here;
}
