import { useQuery } from "@tanstack/react-query";
import type { DraftEntry } from "./drafts.ts";
import { useDrive } from "./drive-context.ts";
import { Link } from "./Link.tsx";
import { metadataQuery } from "./queries.ts";
import { hrefOf } from "./router.ts";

const KEPT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The notes with unsaved changes kept on the device, as Home lists them. */
export function UnsavedNotes({ drafts }: { drafts: DraftEntry[] }) {
  return (
    <ul className="entries">
      {drafts.map((draft) => (
        <li key={draft.fileId}>
          <UnsavedNote draft={draft} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A note with unsaved changes, named as Drive names it once its details
 * come: its page offers the changes back.
 */
function UnsavedNote({ draft }: { draft: DraftEntry }) {
  const { drive } = useDrive();
  const file = { id: draft.fileId, resourceKey: draft.resourceKey };
  const details = useQuery(metadataQuery(drive, file));
  const name = details.data?.name ?? draft.name ?? "Note";
  return (
    <Link to={hrefOf({ name: "file", file })} className="entry file">
      <span className="name">{name}</span>
      <time dateTime={draft.keptAt} className="when">
        {KEPT.format(new Date(draft.keptAt))}
      </time>
    </Link>
  );
}
