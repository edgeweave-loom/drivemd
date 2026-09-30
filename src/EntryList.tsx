import { Link } from "./Link.tsx";
import type { Entry } from "./listing.ts";
import { hrefOf, type Crumb } from "./router.ts";

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
        <li key={entry.item.id}>
          <EntryLink entry={entry} trail={trail} />
        </li>
      ))}
    </ul>
  );
}

function EntryLink({
  entry: { kind, item, opens },
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
      trail={trail && [...trail, { name: item.name, href }]}
      className={`entry ${kind}`}
    >
      <span className="name">{item.name}</span>
      {item.target && <span className="badge">Shortcut</span>}
    </Link>
  );
}
