import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { ConfirmDialog } from "./Dialog.tsx";
import { describeError } from "./errors.ts";
import type { EditorHandle } from "./Editor.tsx";
import {
  TooLargeError,
  type DriveItem,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { InSlot } from "./InSlot.tsx";
import { commandKey } from "./keys.ts";
import { openedFromDrive } from "./drive-tab.ts";
import { PHONE, useLayout } from "./layout.ts";
import { Loaded } from "./Loaded.tsx";
import { Missing } from "./Missing.tsx";
import { ModeMenu } from "./ModeMenu.tsx";
import { useFollow } from "./follow.ts";
import { Rendered } from "./Markdown.tsx";
import { deleteDraftHolding, type Draft } from "./drafts.ts";
import { useKeptDraft } from "./keep-draft.ts";
import {
  contentQuery,
  draftQuery,
  MAX_CONTENT,
  metadataQuery,
  refreshAfterChange,
  setDetails,
} from "./queries.ts";
import { showPart } from "./parts.ts";
import {
  guardLeaving,
  hrefOf,
  navigate,
  usePlace,
  type Place,
} from "./router.ts";
import { saveText, type SaveResult } from "./save.ts";
import { decode, encode, sameBytes, type FileText } from "./text.ts";
import { useNoteVault, type NoteVault } from "./vaults.ts";

// The editor loads with the first Edit, not with the viewer.
const Editor = lazy(() =>
  import("./Editor.tsx").then(
    ({ Editor }) => ({ default: Editor }),
    () => ({ default: EditorMissing }),
  ),
);

// The differences load with the first conflict, with the editor's code.
const Differences = lazy(() =>
  import("./Differences.tsx").then(
    ({ Differences }) => ({ default: Differences }),
    () => ({ default: DifferencesMissing }),
  ),
);

function DifferencesMissing() {
  return <Missing part="view of the differences" />;
}

function EditorMissing() {
  return <Missing part="editor" />;
}

const KEPT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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
 * A revision the page holds to: with the user's edits, or one the page has
 * not heard of yet, or else one opened in the editor.
 */
interface Held {
  opened: FileMetadata;
  text?: string;
  /** Newer than the page's details: just saved, or kept after a conflict. */
  newer?: true;
}

/**
 * Whether the page, out of the editor, may show Drive's latest revision
 * again: its edits were undone by hand, or Drive told it of the one saved,
 * or it held one only for the editor.
 */
function released(
  { opened, text, newer }: Held,
  file: FileMetadata,
  note: Note | undefined,
): boolean {
  if (text !== undefined) return text === note?.text;
  return !newer || sameRevision(opened, file);
}

/** Someone wrote to the copy between its making and its filling. */
class CopyTakenError extends Error {
  override readonly name = "CopyTakenError";
  constructor() {
    super(
      "Someone wrote to the copy before DriveMD could. Your changes are still here: try again for a new copy.",
    );
  }
}

/** A save: the bytes and their text, over another revision if chosen. */
interface Saving {
  bytes: Uint8Array<ArrayBuffer>;
  text: string;
  over?: FileMetadata;
}

/** The name of a copy saved after a conflict: "plan.md" gives "plan (conflict).md". */
function conflictName(name: string): string {
  return name.replace(/(\.(md|markdown))?$/i, " (conflict)$1");
}

/**
 * Someone else saved the file since the user opened it: their version
 * against the user's, and the user's choice of which to keep.
 */
function Conflict({
  theirs,
  mine,
  busy,
  error,
  onKeep,
  onOverwrite,
  onCopy,
}: {
  theirs: FileMetadata;
  mine: string;
  busy: boolean;
  error: Error | null;
  onKeep: () => void;
  onOverwrite: () => void;
  /** Saves the user's version beside the file, when its folder is known. */
  onCopy: (() => void) | undefined;
}) {
  const { drive } = useDrive();
  const content = useQuery({ ...contentQuery(drive, theirs), select: read });
  const id = useId();
  // Dropping the user's changes cannot be undone: it is confirmed first.
  const [dropping, setDropping] = useState(false);
  return (
    <section className="conflict" aria-labelledby={id}>
      <h3 id={id}>Someone changed this file in Google Drive</h3>
      <p>
        They saved a version since you opened yours, so DriveMD saved nothing.
        Below, what yours removes from theirs is struck through, and what it
        adds is underlined.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDropping(true);
          }}
        >
          Keep the Drive version
        </button>
        <button type="button" disabled={busy} onClick={onOverwrite}>
          Overwrite with mine
        </button>
        {onCopy && (
          <button type="button" disabled={busy} onClick={onCopy}>
            Save mine as a copy
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="failure">
          {error instanceof CopyTakenError
            ? error.message
            : describeError(error)}
        </p>
      )}
      {dropping && (
        <ConfirmDialog
          title="Drop your changes?"
          action="Drop my changes"
          danger
          pending={false}
          error={null}
          onConfirm={onKeep}
          onClose={() => {
            setDropping(false);
          }}
        >
          <p>
            Your version of the note goes, and Google Drive's stays. This cannot
            be undone.
          </p>
        </ConfirmDialog>
      )}
      <Loaded query={content}>
        {(note) => (
          <Suspense fallback={<p className="hint">Loading the differences…</p>}>
            <Differences theirs={note.text} mine={mine} />
          </Suspense>
        )}
      </Loaded>
    </section>
  );
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
  const { drive, account } = useDrive();
  const client = useQueryClient();
  // The revision the page holds to, with the edits made to it, rather than
  // Drive's latest: one the user edited, one open in the editor, or one just
  // saved, until the page hears of it.
  const [held, setHeld] = useState<Held>();
  // Whether the editor shows, and on a phone, the source or the preview:
  // kept while another revision loads.
  const [editing, setEditing] = useState(false);
  function edit(open: boolean) {
    // The editor holds to the revision it opens with.
    if (open) setHeld((now) => now ?? { opened: file });
    setEditing(open);
  }
  // A tab opened from Drive opens the note in Editing on a wide screen, as
  // Docs opens a document on a computer, and in reading on a phone: once,
  // as the note first shows, if the user may edit it.
  const [opening, setOpening] = useState(
    () => openedFromDrive() && !window.matchMedia(PHONE).matches,
  );
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
  // Asked beside the content, so that the note waits for neither in turn.
  const vault = useNoteVault({ id: file.id, resourceKey: file.resourceKey });
  // The address whose part showed last, kept as other revisions load.
  const reached = useRef<Place>(undefined);
  const firstAt = useCallback((place: Place) => {
    if (reached.current === place) return false;
    reached.current = place;
    return true;
  }, []);
  // The edits stay on the device until saved or dropped, and a note opened
  // again offers them back.
  const unsaved = held?.text !== undefined && held.text !== content.data?.text;
  const edits = useMemo(
    () =>
      held?.text === undefined || !unsaved
        ? undefined
        : {
            fileId: file.id,
            name: file.name,
            resourceKey: file.resourceKey,
            headRevisionId: held.opened.headRevisionId,
            md5Checksum: held.opened.md5Checksum,
            text: held.text,
          },
    [held, unsaved, file.id, file.name, file.resourceKey],
  );
  const kept = useQuery(draftQuery(account, file.id));
  const dropDraft = useKeptDraft(account, file.id, edits, () => {
    client.setQueryData(draftQuery(account, file.id).queryKey, null);
  });
  // Text on the device that is the note's own holds nothing unsaved: the
  // device forgets it, if the page shows Drive's latest revision rather than
  // one from its cache, and unless another tab kept newer text since, which
  // the note then offers.
  const keptAsIs =
    held?.text === undefined && kept.data?.text === content.data?.text
      ? kept.data?.text
      : undefined;
  const forgetKept = useEffectEvent(async (text: string) => {
    try {
      const latest = await client.query({
        ...metadataQuery(drive, file),
        staleTime: 0,
      });
      if (sameRevision(latest, opened)) {
        await deleteDraftHolding(account, file.id, text);
      }
    } catch {
      // Kept: the note shows it again.
    }
    await client.invalidateQueries({
      queryKey: draftQuery(account, file.id).queryKey,
    });
  });
  useEffect(() => {
    if (keptAsIs !== undefined) void forgetKept(keptAsIs);
  }, [keptAsIs]);
  if (opening && content.data) {
    setOpening(false);
    if (readOnly(file, content.data) === undefined) edit(true);
  }
  // Out of the editor, the page shows Drive's latest again once it holds no
  // edits, or once it heard of the revision just saved; in the editor, Drive
  // never changes the text being typed.
  if (held && !editing && released(held, file, content.data)) {
    setHeld(undefined);
  }
  // Someone else's revision, which a save found, until the user settles it.
  const [conflict, setConflict] = useState<FileMetadata>();
  const save = useMutation({
    // Over the revision opened, or over someone else's, which the user chose
    // to overwrite after a conflict: theirs is kept in the history.
    mutationFn: ({ bytes, over }: Saving) =>
      saveText(drive, over ?? opened, bytes, {
        keep:
          over !== undefined ||
          !(
            opened.headRevisionId !== undefined &&
            written.has(opened.headRevisionId)
          ),
      }),
    onSuccess: (result, { bytes, text }) => {
      // Drive said which revision it holds: the page's details follow.
      if ("conflict" in result) {
        setDetails(client, result.conflict);
        setConflict(result.conflict);
        return;
      }
      setConflict(undefined);
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
          : { opened: saved, newer: true },
      );
    },
  });
  const madeCopy = useRef<DriveItem | undefined>(undefined);
  // The user's version, saved as a copy beside the file after a conflict,
  // which then opens.
  const copy = useMutation({
    mutationFn: async ({
      bytes,
      folder,
    }: {
      bytes: Uint8Array<ArrayBuffer>;
      folder: string;
    }) => {
      // A copy made by an attempt whose write failed takes the next one.
      const made = (madeCopy.current ??= await drive.createFile(
        { id: folder },
        conflictName(opened.name),
      ));
      const result = await saveText(
        drive,
        await drive.getMetadata(made),
        bytes,
        { keep: false },
      );
      if ("conflict" in result) {
        // The page keeps the edits, and the next attempt makes a new copy.
        madeCopy.current = undefined;
        throw new CopyTakenError();
      }
      return result.saved;
    },
    onSuccess: (made) => {
      dropDraft();
      refreshAfterChange(client, made);
      // The edits are in the copy: the note may go without asking.
      navigate(hrefOf({ name: "file", file: made }), undefined, {
        asked: true,
      });
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
        <>
          {offered(kept.data, held, note) && (
            <Restore
              draft={kept.data}
              onRestore={(draft) => {
                // A draft of an older revision keeps that one, so that its
                // save shows what Drive holds since.
                setHeld({
                  opened: {
                    ...opened,
                    headRevisionId: draft.headRevisionId,
                    md5Checksum: draft.md5Checksum,
                  },
                  text: draft.text,
                });
              }}
              onDiscard={dropDraft}
            />
          )}
          <NoteView
            file={file}
            note={note}
            vault={vault}
            firstAt={firstAt}
            waiting={offered(kept.data, held, note)}
            session={shown.session}
            editing={editing}
            onEditing={edit}
            pane={pane}
            onPane={setPane}
            text={held?.text ?? note.text}
            onEdit={(edited) => {
              setHeld({ opened, text: edited });
            }}
            save={save}
            copy={copy}
            conflict={conflict}
            onKeepTheirs={(theirs) => {
              // Their revision shows, in the editor too, without the edits.
              setHeld({ opened: theirs, newer: true });
              setConflict(undefined);
              save.reset();
              copy.reset();
              madeCopy.current = undefined;
            }}
          />
        </>
      )}
    </Loaded>
  );
}

/**
 * Whether unsaved changes kept on the device are offered: the page holds no
 * edits, and the device's text is not the note's.
 */
function offered(
  draft: Draft | null | undefined,
  held: Held | undefined,
  note: Note,
): draft is Draft {
  return (
    Boolean(draft) && held?.text === undefined && draft?.text !== note.text
  );
}

/** Unsaved changes kept on the device, which the user may restore. */
function Restore({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: Draft;
  onRestore: (draft: Draft) => void;
  onDiscard: () => void;
}) {
  return (
    <div className="warning restore">
      <p>
        You have unsaved changes to this note from{" "}
        {KEPT.format(new Date(draft.keptAt))}, kept on this device.
      </p>
      <div className="actions">
        <button
          type="button"
          className="filled"
          onClick={() => {
            onRestore(draft);
          }}
        >
          Restore
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Save, always in the same place and at the same width, so that nothing
 * beside it moves: "Saved", a status that stays legible, "Save", or
 * "Saving…" while Drive writes. Saved and Saving… stay reachable, to say
 * where the note stands, but save nothing; a screen reader hears the change.
 */
function Save({
  state,
  onSave,
}: {
  state: "saved" | "save" | "saving";
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      className={`save ${state === "save" ? "filled" : state === "saving" ? "tonal" : "saved"}`}
      aria-disabled={state === "save" ? undefined : true}
      aria-live="polite"
      onClick={onSave}
    >
      {state === "saved" && <Icon name="cloud_done" />}
      {state === "saving" && <span className="spinner" />}
      {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save"}
    </button>
  );
}

/**
 * The note, as rendered, and its source in the editor once the user taps
 * Edit: beside the preview on a wide screen, or in its place on a phone.
 */
function NoteView({
  file,
  note,
  vault,
  firstAt,
  waiting,
  session,
  editing,
  onEditing,
  pane,
  onPane,
  text,
  onEdit,
  save,
  copy,
  conflict,
  onKeepTheirs,
}: {
  file: FileMetadata;
  note: Note;
  vault: NoteVault;
  /** Whether the page reaches this address for the first time. */
  firstAt: (place: Place) => boolean;
  /** Unsaved changes on the device wait for the user's answer first. */
  waiting: boolean;
  /** Changes when the editor must start again from the note's text. */
  session: number;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  pane: Pane;
  onPane: (pane: Pane) => void;
  /** The text with the user's edits. */
  text: string;
  onEdit: (text: string) => void;
  save: UseMutationResult<SaveResult, Error, Saving>;
  copy: UseMutationResult<
    FileMetadata,
    Error,
    { bytes: Uint8Array<ArrayBuffer>; folder: string }
  >;
  /** Someone else's revision, which the user has yet to settle. */
  conflict: FileMetadata | undefined;
  /** Drops the edits for the revision someone else saved. */
  onKeepTheirs: (theirs: FileMetadata) => void;
}) {
  const { renew } = useDrive();
  const layout = useLayout();
  const editor = useRef<EditorHandle>(null);
  const follow = useFollow(
    folderOf(file),
    vault.state === "inside" ? vault.vault : undefined,
  );
  // Beside the editor, the preview catches up with typing when it can.
  const deferred = useDeferredValue(text);
  const reason = readOnly(file, note);
  const editable = reason === undefined && !waiting;
  const bytes = encode(text, note);
  // Only bytes that changed are written, and never those of a file DriveMD
  // only shows: its text may not be its bytes.
  const unsaved = editable && !sameBytes(bytes, note.bytes);
  // Leaving the note with unsaved changes asks first: the browser does, for
  // a reload or another site, and the app does, for its own pages. Its own
  // address may change, as on a rename.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    guardLeaving(
      (to) =>
        (to.name === "file" && to.file.id === file.id) ||
        window.confirm("This note has unsaved changes. Leave it anyway?"),
    );
    return () => {
      window.removeEventListener("beforeunload", warn);
      guardLeaving(undefined);
    };
  }, [unsaved, file.id]);
  // The tab says that the note holds unsaved changes.
  useEffect(() => {
    if (!unsaved) return;
    const title = document.title;
    document.title = `• ${title}`;
    return () => {
      document.title = title;
    };
  }, [unsaved]);
  const [folder] = file.parents;
  // A phone reading the note floats Edit over it; Done is in the bar.
  const floats = editable && layout === "phone" && !editing;
  // Edit and Done are then two buttons: the focus goes from the one pressed
  // to the one that takes its place.
  const toggled = useRef(false);
  const toggling = useCallback((button: HTMLButtonElement | null) => {
    if (!button || !toggled.current) return;
    toggled.current = false;
    button.focus();
  }, []);
  /** Writes the text, then does `then` once saved without a conflict. */
  function write(next: string, then?: () => void) {
    renew();
    save.mutate(
      { bytes: encode(next, note), text: next },
      then && {
        onSuccess: (result) => {
          if (!("conflict" in result)) then();
        },
      },
    );
  }
  /**
   * Saves the note, if anything changed, then does `then` once saved; not
   * while a conflict is open, which only the user's choice settles.
   */
  function saveThen(then?: () => void) {
    if (!unsaved || save.isPending || conflict) return;
    write(text, then);
  }
  function saveNow() {
    saveThen();
  }
  // The text as it stands, which a save that ends compares with its own.
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  // Viewing saves first: when someone else changed the note, or the save
  // fails, the note stays in Editing with the banner that says why, and so
  // it does when more was typed meanwhile, which is left to save.
  function view(leaving?: () => void) {
    const leave = () => {
      leaving?.();
      onEditing(false);
    };
    if (!unsaved) {
      leave();
      return;
    }
    const saving = text;
    saveThen(() => {
      if (latest.current === saving) leave();
    });
  }
  // Cmd or Ctrl+S saves the note, where the editor or the viewer is, and
  // never the page itself, which would hold none of the note's bytes.
  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!commandKey(event) || event.altKey || event.shiftKey) return;
    // The key labelled S, or where S is on a layout that is not Latin.
    const { key = "", code } = event as Partial<KeyboardEvent>;
    const latin = /^[a-z]$/i.test(key);
    if (latin ? key.toLowerCase() !== "s" : code !== "KeyS") return;
    event.preventDefault();
    saveNow();
  });
  useEffect(() => {
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  const source =
    editing && editable && (layout !== "phone" || pane === "source");
  const rendered =
    !(editing && editable) || layout !== "phone" || pane === "preview";
  const previewed = source ? deferred : text;
  // A task ticked in the note shown: while viewing, it saves at once, as on
  // GitHub, so that a note being read holds no unsaved changes, unless other
  // edits wait to be saved, which it joins rather than saving them unasked;
  // the tasks wait while it saves, and while a conflict is to settle. While
  // editing, it is an edit like any other, which the editor takes beside it.
  const onTask = !editable
    ? undefined
    : editing
      ? source
        ? (toggled: string) => {
            if (editor.current) editor.current.offer(previewed, toggled);
            else onEdit(toggled);
          }
        : onEdit
      : save.isPending || conflict
        ? undefined
        : unsaved
          ? onEdit
          : (toggled: string) => {
              onEdit(toggled);
              write(toggled);
            };
  const shown = rendered && vault.state !== "checking";
  // The part of the note the address leads to shows once the note does,
  // each time the address changes, but not as the note changes.
  const place = usePlace();
  useEffect(() => {
    if (!shown || !firstAt(place)) return;
    if (place.fragment !== undefined) showPart(place.fragment);
  }, [shown, place, firstAt]);
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
        {editable &&
          !floats &&
          (layout === "phone" ? (
            // A check at the start of the bar, which saves first, as Viewing
            // does, then gives way to the floating Edit. It gives way to
            // Back, which leaves the note, while a save failed or a conflict
            // is open, as the note can then neither save nor be read alone.
            !save.error &&
            !conflict && (
              <InSlot name="lead">
                <button
                  ref={toggling}
                  type="button"
                  className="icon-button"
                  aria-label="Done"
                  title="Done"
                  onClick={() => {
                    view(() => {
                      toggled.current = true;
                    });
                  }}
                >
                  <Icon name="check" />
                </button>
              </InSlot>
            )
          ) : (
            <InSlot name="mode">
              <ModeMenu
                editing={editing}
                onPick={(edits) => {
                  if (edits) onEditing(true);
                  else view();
                }}
              />
            </InSlot>
          ))}
        {/* While the page waits for an answer about changes kept on the
            device, too: nothing is unsaved yet. During a conflict, only while
            the user's version overwrites Drive's. */}
        {reason === undefined && (!conflict || save.isPending) && (
          <InSlot name="save">
            <Save
              state={save.isPending ? "saving" : unsaved ? "save" : "saved"}
              onSave={saveNow}
            />
          </InSlot>
        )}
      </div>
      {conflict && (
        <Conflict
          theirs={conflict}
          mine={text}
          busy={save.isPending || copy.isPending}
          error={copy.error ?? save.error}
          onKeep={() => {
            onKeepTheirs(conflict);
          }}
          onOverwrite={() => {
            renew();
            copy.reset();
            save.mutate({ bytes, text, over: conflict });
          }}
          onCopy={
            folder === undefined
              ? undefined
              : () => {
                  renew();
                  save.reset();
                  copy.mutate({ bytes, folder });
                }
          }
        />
      )}
      {save.error && !conflict && (
        <p role="alert" className="failure">
          {describeError(save.error)}
        </p>
      )}
      {/* On a sheet, as Docs shows a page on a wide screen, or while
          editing there, the source and the preview on two, side by side.
          The note shown keeps its place as editing starts and ends. */}
      <div className={source && rendered ? "sheets editing" : "sheets"}>
        {source && (
          <Sheet label={rendered && "Markdown"} icon="code">
            <Suspense fallback={<p className="hint">Loading the editor…</p>}>
              <Editor
                key={session}
                ref={editor}
                initial={text}
                lineBreak={note.lineBreak}
                onChange={onEdit}
                onFollow={follow}
              />
            </Suspense>
          </Sheet>
        )}
        {rendered && (
          <Sheet label={source && "Preview"} icon="visibility">
            {vault.state === "checking" && (
              // Rendered as Markdown first, a note of a vault would change
              // once the check answers.
              <p className="hint">Loading…</p>
            )}
            {vault.state === "unknown" && (
              <p className="hint">
                DriveMD could not check whether this note is in an Obsidian
                vault, so it shows as Markdown, without Obsidian's syntax.
              </p>
            )}
            {shown && (
              <Rendered
                text={previewed}
                folder={folderOf(file)}
                vault={vault.state === "inside" ? vault.vault : undefined}
                note={file}
                onEdit={onTask}
              />
            )}
          </Sheet>
        )}
      </div>
      {floats && (
        // Floating over the note a phone reads, as in Docs's app, and after
        // it, where it shows.
        <button
          ref={toggling}
          type="button"
          className="tonal fab"
          onClick={() => {
            toggled.current = true;
            onEditing(true);
          }}
        >
          <Icon name="edit" />
          Edit
        </button>
      )}
    </>
  );
}

/**
 * A sheet of the note, named where another shows beside it: a region of the
 * page, which leaves the note's own headings as they are.
 */
function Sheet({
  label,
  icon,
  children,
}: {
  label: string | false;
  icon: IconName;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="sheet" aria-labelledby={label ? id : undefined}>
      {label && (
        <p className="label" id={id}>
          <Icon name={icon} />
          {label}
        </p>
      )}
      {children}
    </section>
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
