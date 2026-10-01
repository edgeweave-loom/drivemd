import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { describeError } from "./errors.ts";
import { TooLargeError, type FileMetadata, type FileRef } from "./drive.ts";
import { Loaded } from "./Loaded.tsx";
import { Rendered } from "./Markdown.tsx";
import { contentQuery, MAX_CONTENT, setDetails } from "./queries.ts";
import { saveText } from "./save.ts";
import { decode, encode, sameBytes, type FileText } from "./text.ts";

const MEGABYTES = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

/** A Markdown file's content, rendered, once Drive has sent it. */
export function FileContent({ file }: { file: FileMetadata }) {
  if (!file.capabilities.canDownload) {
    return (
      <p>
        The file's owner does not let you download it, so DriveMD cannot show
        it. <InDrive file={file} />
      </p>
    );
  }
  if (file.size !== undefined && file.size > MAX_CONTENT) {
    return <TooLarge file={file} size={MEGABYTES.format(file.size / 1e6)} />;
  }
  return <Content file={file} />;
}

/** The note as Drive holds it: its bytes, and their text. */
type Note = FileText & { bytes: Uint8Array<ArrayBuffer> };

function read(bytes: Uint8Array<ArrayBuffer>): Note {
  return { ...decode(bytes), bytes };
}

/**
 * The note, which shows Drive's latest revision until the user edits it; the
 * edits then stay on the revision they were made to, whatever Drive says
 * since, and a save checks that nobody else changed it.
 */
function Content({ file }: { file: FileMetadata }) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  // The revision the page holds to, with the edits made to it, rather than
  // Drive's latest: one the user edited, or one just saved, until the page
  // hears of it.
  const [held, setHeld] = useState<{ opened: FileMetadata; text?: string }>();
  if (held && held.text === undefined && sameRevision(held.opened, file)) {
    setHeld(undefined);
  }
  // The revisions saved from this page, which the next save need not keep:
  // the one from before the first edit is kept, as is one someone else made.
  const [written, setWritten] = useState<ReadonlySet<string>>(new Set());
  const opened = held?.opened ?? file;
  const content = useQuery({ ...contentQuery(drive, opened), select: read });
  const save = useMutation({
    mutationFn: ({ bytes }: { bytes: Uint8Array<ArrayBuffer>; text: string }) =>
      saveText(drive, opened, bytes, {
        keep: !(
          opened.headRevisionId !== undefined &&
          written.has(opened.headRevisionId)
        ),
      }),
    onSuccess: (result, { bytes, text }) => {
      if ("conflict" in result) return;
      const { saved } = result;
      if (saved.headRevisionId !== undefined) {
        setWritten(
          (before) => new Set([...before, saved.headRevisionId ?? ""]),
        );
      }
      // The page shows the saved revision at once, without reading it back,
      // with any edit made while it was saving.
      client.setQueryData(contentQuery(drive, saved).queryKey, bytes);
      setDetails(client, saved);
      setHeld((now) =>
        now?.text !== undefined && now.text !== text
          ? { opened: saved, text: now.text }
          : { opened: saved },
      );
    },
  });
  // The file grew since Drive gave its size.
  if (content.error instanceof TooLargeError) {
    return (
      <TooLarge
        file={file}
        size={`over ${MEGABYTES.format(MAX_CONTENT / 1e6)}`}
      />
    );
  }
  return (
    <Loaded query={content}>
      {(note) => {
        const reason = readOnly(file, note);
        const text = held?.text ?? note.text;
        const bytes = encode(text, note);
        // Only bytes that changed are written, and never those of a file
        // DriveMD only shows: its text may not be its bytes.
        const unsaved = reason === undefined && !sameBytes(bytes, note.bytes);
        return (
          <>
            {reason && <p className="badge read-only">{reason}</p>}
            {unsaved && (
              <div className="unsaved">
                <span className="hint">Unsaved changes</span>
                <button
                  type="button"
                  className="primary"
                  disabled={save.isPending}
                  onClick={() => {
                    renew();
                    save.mutate({ bytes, text });
                  }}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            )}
            {save.data && "conflict" in save.data && (
              <p role="alert" className="failure">
                Someone changed this file in Google Drive since you opened it,
                so DriveMD saved nothing. Your changes are still here.
              </p>
            )}
            {save.error && (
              <p role="alert" className="failure">
                {describeError(save.error)}
              </p>
            )}
            <Rendered
              text={text}
              folder={folderOf(file)}
              onEdit={
                reason === undefined
                  ? (edited) => {
                      // Edits undone by hand leave Drive's revisions to show.
                      setHeld(
                        edited === note.text
                          ? undefined
                          : { opened, text: edited },
                      );
                    }
                  : undefined
              }
            />
          </>
        );
      }}
    </Loaded>
  );
}

function TooLarge({ file, size }: { file: FileMetadata; size: string }) {
  return (
    <p>
      This file holds {size}, and DriveMD opens files up to{" "}
      {MEGABYTES.format(MAX_CONTENT / 1e6)}. <InDrive file={file} />
    </p>
  );
}

/**
 * The folder the file sits in, where its relative links start; Drive gives
 * none for a file whose folder the user cannot reach.
 */
function folderOf({ parents: [parent] }: FileMetadata): FileRef | undefined {
  return parent === undefined ? undefined : { id: parent };
}

function sameRevision(one: FileMetadata, other: FileMetadata): boolean {
  return (
    one.headRevisionId === other.headRevisionId &&
    one.md5Checksum === other.md5Checksum
  );
}

/** Why the user cannot edit the file, if they cannot. */
function readOnly(file: FileMetadata, text: FileText): string | undefined {
  if (file.locked) {
    return file.lockReason ? `Locked: ${file.lockReason}` : "Locked";
  }
  const { canModifyContent, canComment } = file.capabilities;
  if (!canModifyContent) return canComment ? "Comment only" : "View only";
  switch (text.readOnly) {
    case "not-utf8":
      return "Not UTF-8 text: DriveMD only shows it";
    case "mixed-line-breaks":
      return "Mixed line breaks: DriveMD only shows it";
    case undefined:
      return undefined;
  }
}

/** A link to the file in Google Drive, which opens what DriveMD cannot. */
function InDrive({ file }: { file: FileMetadata }) {
  return (
    <a href={inDrive(file)} target="_blank" rel="noreferrer">
      Open it in Google Drive
    </a>
  );
}
