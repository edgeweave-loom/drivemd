import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useId } from "react";
import { useDrive } from "./drive-context.ts";
import type { DriveItem, ShortcutTarget } from "./drive.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { Link } from "./Link.tsx";
import { BROKEN, entriesOf, modifiedLine, type Entry } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { shortcutQuery } from "./queries.ts";
import { hrefOf, type Crumb } from "./router.ts";

/** The entries among the items the query finds, once Drive has answered. */
export function ItemListing<Answer, Key extends QueryKey>({
  query,
  order,
  trail,
  current,
  missing,
  empty,
  folders,
}: {
  query: UseQueryOptions<Answer, Error, DriveItem[], Key>;
  /** By name, unless Drive's own order says more, as in search results. */
  order?: "by-name" | "as-listed";
  trail: Crumb[] | undefined;
  /** The ID of the item the page shows, if the list holds it. */
  current?: string;
  /** What to say when Drive answers that the list's source is not there. */
  missing?: string;
  empty: string;
  /** How the list's folders show, when they are more than folders. */
  folders?: IconName;
}) {
  const items = useQuery(query);
  return (
    <Loaded query={items} missing={missing}>
      {(found) => (
        <EntryList
          entries={entriesOf(found, order)}
          trail={trail}
          current={current}
          empty={empty}
          folders={folders}
        />
      )}
    </Loaded>
  );
}

/** Folders and files to open, extending the path the user took. */
export function EntryList({
  entries,
  trail,
  current,
  empty,
  folders = "folder",
}: {
  entries: Entry[];
  trail: Crumb[] | undefined;
  current?: string | undefined;
  /** What to say when there is nothing to show. */
  empty: string;
  folders?: IconName | undefined;
}) {
  if (entries.length === 0) return <p className="hint">{empty}</p>;
  return (
    <ul className="entries">
      {/* The table's head, which each row's name and description say. */}
      {entries.some((entry) => modifiedLine(entry) !== undefined) && (
        <li className="entries-head" aria-hidden="true">
          <span>Name</span>
          <span>Modified</span>
        </li>
      )}
      {entries.map((entry) => (
        <li key={entry.id}>
          {entry.target ? (
            <ShortcutEntry
              entry={entry}
              target={entry.target}
              trail={trail}
              current={entry.opens.id === current}
            />
          ) : (
            <EntryLink
              entry={entry}
              trail={trail}
              current={entry.opens.id === current}
              folders={folders}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function EntryLink({
  entry,
  trail,
  current = false,
  folders = "folder",
}: {
  entry: Entry;
  trail: Crumb[] | undefined;
  /** Whether the page shows the entry itself. */
  current?: boolean;
  folders?: IconName;
}) {
  const { kind, name, opens, target } = entry;
  const ids = useId();
  const when = modifiedLine(entry);
  const note = current ? "description_fill" : "description";
  const icon = target ? "shortcut" : kind === "folder" ? folders : note;
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
      current={current}
      // Named by its name; when it changed, described.
      aria-labelledby={`${ids}-title`}
      aria-describedby={when && `${ids}-when`}
    >
      <Icon name={icon} />
      <span id={`${ids}-title`} className="title">
        <span className="name">{name}</span>
        {target && (
          <>
            {" "}
            <span className="badge">Shortcut</span>
          </>
        )}
      </span>
      {when && (
        <span id={`${ids}-when`} className="modified">
          {when}
        </span>
      )}
      {kind === "folder" && <Icon name="chevron_right" />}
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
  current,
}: {
  entry: Entry;
  target: ShortcutTarget;
  trail: Crumb[] | undefined;
  current: boolean;
}) {
  const { drive } = useDrive();
  const ids = useId();
  const check = useQuery(shortcutQuery(drive, target));
  const broken = check.data;
  if (!broken) {
    return <EntryLink entry={entry} trail={trail} current={current} />;
  }
  return (
    // A link without an address: it is there, but opens nothing.
    <a
      role="link"
      aria-disabled="true"
      className={`entry ${entry.kind} broken`}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-why`}
    >
      <Icon name="link_off" />
      <span id={`${ids}-title`} className="title">
        <span className="name">{entry.name}</span>{" "}
        <span className="badge">Shortcut</span>
      </span>
      {/* Why it opens nothing, where its time of change would be. */}
      <span id={`${ids}-why`} className="modified reason">
        {BROKEN[broken]}
      </span>
    </a>
  );
}
