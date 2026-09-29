import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { DriveItem, ShortcutTarget } from "./drive.ts";
import { Link } from "./Link.tsx";
import { entriesOf, type Entry } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { hrefOf, type Crumb } from "./router.ts";

const BROKEN = {
  missing: "Deleted, or not shared with you",
  trashed: "In the trash",
};

/** The entries among the items `list` finds, once Drive has answered. */
export function ItemListing({
  queryKey,
  list,
  order,
  trail,
  missing,
  empty,
}: {
  queryKey: QueryKey;
  list: () => Promise<DriveItem[]>;
  /** By name, unless Drive's own order says more, as in search results. */
  order?: "by-name" | "as-listed";
  trail: Crumb[] | undefined;
  /** What to say when Drive answers that the list's source is not there. */
  missing: string;
  empty: string;
}) {
  const items = useQuery({ queryKey, queryFn: list });
  return (
    <Loaded query={items} missing={missing}>
      {(found) => (
        <EntryList
          entries={entriesOf(found, order)}
          trail={trail}
          empty={empty}
        />
      )}
    </Loaded>
  );
}

/** Folders and files to open, extending the path the user took. */
export function EntryList({
  entries,
  trail,
  empty,
}: {
  entries: Entry[];
  trail: Crumb[] | undefined;
  /** What to say when there is nothing to show. */
  empty: string;
}) {
  if (entries.length === 0) return <p className="hint">{empty}</p>;
  return (
    <ul className="entries">
      {entries.map((entry) => (
        <li key={entry.id}>
          {entry.target ? (
            <ShortcutEntry entry={entry} target={entry.target} trail={trail} />
          ) : (
            <EntryLink entry={entry} trail={trail} />
          )}
        </li>
      ))}
    </ul>
  );
}

function EntryLink({
  entry: { kind, name, opens, target },
  trail,
}: {
  entry: Entry;
  trail: Crumb[] | undefined;
}) {
  const href = hrefOf(
    kind === "folder"
      ? { name: "folder", folder: opens }
      : { name: "file", file: opens },
  );
  return (
    <Link
      to={href}
      trail={trail && [...trail, { name, href }]}
      className={`entry ${kind}`}
    >
      <span className="name">{name}</span>
      {target && <span className="badge">Shortcut</span>}
    </Link>
  );
}

/**
 * A shortcut shows at once, then greys out if its target turns out to be
 * gone. A check that fails leaves it as it is.
 */
function ShortcutEntry({
  entry,
  target,
  trail,
}: {
  entry: Entry;
  target: ShortcutTarget;
  trail: Crumb[] | undefined;
}) {
  const { drive } = useDrive();
  const check = useQuery({
    queryKey: ["shortcut", target.id, target.resourceKey],
    // A query cannot answer undefined: null says the target opens.
    queryFn: async () => (await drive.checkShortcut(target)) ?? null,
  });
  const broken = check.data;
  if (!broken) return <EntryLink entry={entry} trail={trail} />;
  return (
    // A link without an address: it is there, but opens nothing.
    <a
      role="link"
      aria-disabled="true"
      className={`entry ${entry.kind} broken`}
    >
      <span className="name">{entry.name}</span>
      <span className="badge">Shortcut</span>
      <span className="reason">{BROKEN[broken]}</span>
    </a>
  );
}
