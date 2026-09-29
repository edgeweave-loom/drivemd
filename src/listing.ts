import {
  FOLDER,
  GOOGLE_TYPES,
  isMarkdown,
  type DriveItem,
  type FileRef,
} from "./drive.ts";

/** An item the navigator shows. */
export interface Entry {
  kind: "folder" | "file";
  item: DriveItem;
  /** What a tap opens: a shortcut's target, or the item itself. */
  opens: FileRef;
}

// Natural order: "file2" before "file10", whatever the case.
const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * The folders and Markdown files among the items, and the shortcuts to them,
 * folders first, each in natural order. Names that start with a dot, such as
 * .obsidian, are hidden.
 */
export function entriesOf(items: DriveItem[]): Entry[] {
  const entries = items.flatMap((item): Entry[] => {
    const kind = kindOf(item);
    if (kind === undefined || item.name.startsWith(".")) return [];
    const { id, resourceKey } = item.target ?? item;
    return [{ kind, item, opens: { id, resourceKey } }];
  });
  return entries.sort(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      byName.compare(a.item.name, b.item.name),
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
