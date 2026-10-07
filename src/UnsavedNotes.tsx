import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ConfirmDialog } from "./Dialog.tsx";
import { deleteDraft, type DraftEntry } from "./drafts.ts";
import { useDrive } from "./drive-context.ts";
import { notFound, type FileMetadata } from "./drive.ts";
import { Icon } from "./Icon.tsx";
import { Link } from "./Link.tsx";
import { BROKEN, kindOf } from "./listing.ts";
import { draftsQuery, MAX_CONTENT, metadataQuery } from "./queries.ts";
import { hrefOf } from "./router.ts";

const KEPT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const MEGABYTES = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
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
 * come: its page offers the changes back. A note that no longer opens says
 * why instead, and its changes are discarded here, since no page offers to.
 */
function UnsavedNote({ draft }: { draft: DraftEntry }) {
  const { drive } = useDrive();
  const file = { id: draft.fileId, resourceKey: draft.resourceKey };
  // Asked afresh each time Home shows: the note may open again since, as
  // once restored from Drive's trash.
  const details = useQuery({ ...metadataQuery(drive, file), staleTime: 0 });
  const name = details.data?.name ?? draft.name;
  // Only Drive's answer since Home showed tells whether the note opens: the
  // cache may hold one from before it was restored, or deleted.
  const reason = !details.isFetchedAfterMount
    ? undefined
    : notFound(details.error)
      ? BROKEN.missing
      : details.isSuccess
        ? closed(details.data)
        : undefined;
  if (reason === undefined) {
    return (
      <Link to={hrefOf({ name: "file", file })} className="entry file">
        <Icon name="description" />
        <span className="name">{name}</span>
        <time dateTime={draft.keptAt} className="when">
          {KEPT.format(new Date(draft.keptAt))}
        </time>
      </Link>
    );
  }
  return <ClosedNote draft={draft} name={name} reason={reason} />;
}

/** Why the note's page cannot offer its changes back, if it cannot. */
function closed(file: FileMetadata): string | undefined {
  if (file.trashed) return BROKEN.trashed;
  if (kindOf(file) !== "file") return "Not a Markdown file";
  if (!file.capabilities.canDownload) {
    return "Its owner does not let you download it";
  }
  if (file.size !== undefined && file.size > MAX_CONTENT) {
    return `Over ${MEGABYTES.format(MAX_CONTENT / 1e6)}`;
  }
  return undefined;
}

/**
 * A note whose page cannot offer its changes back: why, and Discard, which
 * asks first, since the changes cannot come back.
 */
function ClosedNote({
  draft,
  name,
  reason,
}: {
  draft: DraftEntry;
  name: string;
  reason: string;
}) {
  const { account } = useDrive();
  const client = useQueryClient();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const discard = useMutation({
    mutationFn: () => deleteDraft(account, draft.fileId),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: draftsQuery(account).queryKey }),
    // The device answers, with or without a connection.
    networkMode: "always",
  });
  return (
    <>
      <div className="entry file">
        <Icon name="description" />
        <span className="lines">
          <span id={`${id}-name`} className="name">
            {name}
          </span>
          <small id={`${id}-reason`}>{reason}</small>
        </span>
        <button
          type="button"
          id={`${id}-discard`}
          // "Discard plan.md": each button says which note it is for.
          aria-labelledby={`${id}-discard ${id}-name`}
          aria-describedby={`${id}-reason`}
          onClick={() => {
            discard.reset();
            setAsking(true);
          }}
        >
          Discard
        </button>
      </div>
      {asking && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          action="Discard"
          danger
          pending={discard.isPending}
          error={discard.error}
          onConfirm={() => {
            discard.mutate(undefined, {
              onSuccess: () => {
                setAsking(false);
              },
            });
          }}
          onClose={() => {
            setAsking(false);
          }}
        >
          <p>
            Your changes to {name} from {KEPT.format(new Date(draft.keptAt))},
            kept on this device, go for good. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
