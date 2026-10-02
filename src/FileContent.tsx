import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { lazy, Suspense, useDeferredValue, useRef, useState } from "react";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { describeError } from "./errors.ts";
import type { EditorHandle } from "./Editor.tsx";
import { TooLargeError, type FileMetadata, type FileRef } from "./drive.ts";
import { useLayout } from "./layout.ts";
import { Loaded } from "./Loaded.tsx";
import { Missing } from "./Missing.tsx";
import { Rendered } from "./Markdown.tsx";
import { contentQuery, MAX_CONTENT, setDetails } from "./queries.ts";
import { saveText, type SaveResult } from "./save.ts";
import { decode, encode, sameBytes, type FileText } from "./text.ts";

// The editor loads with the first Edit, not with the viewer.
const Editor = lazy(() =>
  import("./Editor.tsx").then(
    ({ Editor }) => ({ default: Editor }),
    () => ({ default: EditorMissing }),
  ),
);

function EditorMissing() {
  return <Missing part="editor" />;
}

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

/**
 * A revision the page holds to: with the user's edits, or just saved here,
 * or else opened in the editor.
 */
interface Held {
  opened: FileMetadata;
  text?: string;
  saved?: true;
}

/**
 * Whether the page, out of the editor, may show Drive's latest revision
 * again: its edits were undone by hand, or Drive told it of the one saved,
 * or it held one only for the editor.
 */
function released(
  { opened, text, saved }: Held,
  file: FileMetadata,
  note: Note | undefined,
): boolean {
  if (text !== undefined) return text === note?.text;
  return !saved || sameRevision(opened, file);
}

/** What a phone shows while editing: the source, or the preview. */
type Pane = "source" | "preview";

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
  const { drive } = useDrive();
  const client = useQueryClient();
  // The revision the page holds to, with the edits made to it, rather than
  // Drive's latest: one the user edited, one open in the editor, or one just
  // saved, until the page hears of it.
  const [held, setHeld] = useState<Held>();
  // Whether the editor shows, and on a phone, the source or the preview:
  // kept while another revision loads.
  const [editing, setEditing] = useState(false);
  const [pane, setPane] = useState<Pane>("source");
  // The revisions saved from this page, which the next save need not keep:
  // the one from before the first edit is kept, as is one someone else made.
  const [written, setWritten] = useState<ReadonlySet<string>>(new Set());
  const opened = held?.opened ?? file;
  // An open editor starts again from a revision someone else made, which
  // only shows while there are no edits; one saved here it already holds.
  const revision = `${opened.headRevisionId ?? ""}:${opened.md5Checksum ?? ""}`;
  const [shown, setShown] = useState({ revision, session: 0 });
  if (shown.revision !== revision) {
    const ours =
      opened.headRevisionId !== undefined && written.has(opened.headRevisionId);
    setShown({ revision, session: shown.session + (ours ? 0 : 1) });
  }
  const content = useQuery({ ...contentQuery(drive, opened), select: read });
  // Out of the editor, the page shows Drive's latest again once it holds no
  // edits, or once it heard of the revision just saved; in the editor, Drive
  // never changes the text being typed.
  if (held && !editing && released(held, file, content.data)) {
    setHeld(undefined);
  }
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
      const revision = saved.headRevisionId;
      if (revision !== undefined) {
        setWritten((before) => new Set([...before, revision]));
      }
      // The page shows the saved revision at once, without reading it back,
      // with any edit made while it was saving.
      client.setQueryData(contentQuery(drive, saved).queryKey, bytes);
      setDetails(client, saved);
      setHeld((now) =>
        now?.text !== undefined && now.text !== text
          ? { opened: saved, text: now.text }
          : { opened: saved, saved: true },
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
      {(note) => (
        <NoteView
          file={file}
          note={note}
          session={shown.session}
          editing={editing}
          onEditing={(open) => {
            // The editor holds to the revision it opens with.
            if (open) setHeld((now) => now ?? { opened: file });
            setEditing(open);
          }}
          pane={pane}
          onPane={setPane}
          text={held?.text ?? note.text}
          onEdit={(edited) => {
            setHeld({ opened, text: edited });
          }}
          save={save}
        />
      )}
    </Loaded>
  );
}

/**
 * The note, as rendered, and its source in the editor once the user taps
 * Edit: beside the preview on a wide screen, or in its place on a phone.
 */
function NoteView({
  file,
  note,
  session,
  editing,
  onEditing,
  pane,
  onPane,
  text,
  onEdit,
  save,
}: {
  file: FileMetadata;
  note: Note;
  /** Changes when the editor must start again from the note's text. */
  session: number;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  pane: Pane;
  onPane: (pane: Pane) => void;
  /** The text with the user's edits. */
  text: string;
  onEdit: (text: string) => void;
  save: UseMutationResult<
    SaveResult,
    Error,
    { bytes: Uint8Array<ArrayBuffer>; text: string }
  >;
}) {
  const { renew } = useDrive();
  const layout = useLayout();
  const editor = useRef<EditorHandle>(null);
  // Beside the editor, the preview catches up with typing when it can.
  const deferred = useDeferredValue(text);
  const reason = readOnly(file, note);
  const editable = reason === undefined;
  const bytes = encode(text, note);
  // Only bytes that changed are written, and never those of a file DriveMD
  // only shows: its text may not be its bytes.
  const unsaved = editable && !sameBytes(bytes, note.bytes);
  const source =
    editing && editable && (layout !== "phone" || pane === "source");
  const rendered =
    !(editing && editable) || layout !== "phone" || pane === "preview";
  const previewed = source ? deferred : text;
  return (
    <>
      <div className="note-bar">
        {reason && <p className="badge read-only">{reason}</p>}
        {editable && layout === "phone" && editing && (
          <button
            type="button"
            onClick={() => {
              onPane(pane === "source" ? "preview" : "source");
            }}
          >
            {pane === "source" ? "Preview" : "Source"}
          </button>
        )}
        {editable && (
          <button
            type="button"
            onClick={() => {
              onEditing(!editing);
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
        {unsaved && (
          <>
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
          </>
        )}
      </div>
      {save.data && "conflict" in save.data && (
        <p role="alert" className="failure">
          Someone changed this file in Google Drive since you opened it, so
          DriveMD saved nothing. Your changes are still here.
        </p>
      )}
      {save.error && (
        <p role="alert" className="failure">
          {describeError(save.error)}
        </p>
      )}
      <div className={source && rendered ? "editing" : undefined}>
        {source && (
          <Suspense fallback={<p className="hint">Loading the editor…</p>}>
            <Editor
              key={session}
              ref={editor}
              initial={text}
              lineBreak={note.lineBreak}
              onChange={onEdit}
            />
          </Suspense>
        )}
        {rendered && (
          <Rendered
            text={previewed}
            folder={folderOf(file)}
            onEdit={
              !editable
                ? undefined
                : source
                  ? // The editor, once it shows, holds the text: the tap goes
                    // through it.
                    (toggled) => {
                      if (editor.current)
                        editor.current.offer(previewed, toggled);
                      else onEdit(toggled);
                    }
                  : onEdit
            }
          />
        )}
      </div>
    </>
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
