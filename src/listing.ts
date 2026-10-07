import {
  FOLDER,
  GOOGLE_TYPES,
  isMarkdown,
  type DriveItem,
  type FileRef,
  type ShortcutTarget,
} from "./drive.ts";

/** An item the navigator shows. */
export interface Entry {
  kind: "folder" | "file";
  /** The item's own ID: a shortcut's, not its target's. */
  id: string;
  name: string;
  /** What a tap opens: a shortcut's target, or the item itself. */
  opens: FileRef;
  /** Where a shortcut points, for checking that its target still opens. */
  target: ShortcutTarget | undefined;
  modifiedTime: string | undefined;
  /** Who changed the item last: "you", when the signed-in user did. */
  modifiedBy: string | undefined;
}

const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** When and by whom an entry last changed, as its row says it. */
export function modifiedLine({
  modifiedTime,
  modifiedBy,
}: Entry): string | undefined {
  const time = new Date(modifiedTime ?? Number.NaN);
  if (Number.isNaN(time.getTime())) return;
  const day = DAY.format(time);
  return modifiedBy === undefined ? day : `${day}, by ${modifiedBy}`;
}

/** Why an item that the user reached before no longer opens. */
export const BROKEN = {
  missing: "Deleted, or not shared with you",
  trashed: "In the trash",
};

// Natural order: "file2" before "file10", whatever the case.
const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * The folders and Markdown files among the items, and the shortcuts to them:
 * folders first, then files, each by name, or else in the items' order.
 * Names that start with a dot, such as .obsidian, are hidden.
 */
export function entriesOf(
  items: DriveItem[],
  order: "by-name" | "as-listed" = "by-name",
): Entry[] {
  const entries = items.flatMap((item): Entry[] => {
    const kind = kindOf(item);
    if (kind === undefined || item.name.startsWith(".")) return [];
    const { id, name, target } = item;
    const opens = target ?? item;
    return [
      {
        kind,
        id,
        name,
        opens: { id: opens.id, resourceKey: opens.resourceKey },
        target,
        modifiedTime: item.modifiedTime,
        modifiedBy: item.lastModifiedByMe ? "you" : item.lastModifiedBy,
      },
    ];
  });
  return order === "by-name" ? inOrder(entries) : entries;
}

/** Folders first, then files, each in natural order. */
export function inOrder(entries: Entry[]): Entry[] {
  return entries.toSorted(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      byName.compare(a.name, b.name),
  );
}
/** What a tap on the item opens, if the navigator shows it. */
export function kindOf({
  name,
  mimeType,
  target,
}: DriveItem): Entry["kind"] | undefined {
  // A shortcut is what it points to, but keeps its own name.
  const type = target?.mimeType ?? mimeType;
  if (type === FOLDER) return "folder";
  if (!type.startsWith(GOOGLE_TYPES) && isMarkdown(name)) return "file";
  return undefined;
}
