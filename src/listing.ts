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
}

// Natural order: "file2" before "file10", whatever the case.
const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * The folders and Markdown files among the items, and the shortcuts to them,
 * in order. Names that start with a dot, such as .obsidian, are hidden.
 */
export function entriesOf(items: DriveItem[]): Entry[] {
  return inOrder(
    items.flatMap((item): Entry[] => {
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
        },
      ];
    }),
  );
}

/** Folders first, then files, each in natural order. */
export function inOrder(entries: Entry[]): Entry[] {
  return entries.toSorted(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      byName.compare(a.name, b.name),
  );
}
function kindOf({
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
