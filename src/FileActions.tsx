import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { Icon } from "./Icon.tsx";
import { MoveDialog } from "./Move.tsx";
import type { FileMetadata, FileRef } from "./drive.ts";
import { openedFromDrive } from "./drive-tab.ts";
import { refreshAfterChange, setTrashed } from "./queries.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";

const HOME = hrefOf({ name: "home" });

/** What the user may pick to do with a note. */
export type Action = "move" | "trash";

/** Move, as an icon beside the note's name. */
export function MoveButton({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label="Move"
      title="Move"
      onClick={(event) => {
        // The picker gives the focus back to what had it, which WebKit does
        // not give a button it presses.
        event.currentTarget.focus();
        onPick();
      }}
    >
      <Icon name="drive_file_move" />
    </button>
  );
}

/**
 * The rest of what the user may do with the file, as far as Drive allows, in
 * a menu that closes as an action's dialog opens; Move among them where the
 * page says so.
 */
export function MoreActions({
  file,
  moves,
  onPick,
}: {
  file: FileMetadata;
  moves: boolean;
  onPick: (action: Action) => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { canTrash } = file.capabilities;
  if (!moves && !canTrash) return null;
  const item = (action: Action, label: string) => (
    <button
      type="button"
      onClick={() => {
        // The dialog gives the focus back to what had it as it opened.
        button.current?.focus();
        menu.current?.hidePopover();
        onPick(action);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button"
        popoverTarget={id}
        aria-label="More actions"
        title="More actions"
      >
        <Icon name="more_vert" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="More actions"
        className="menu actions-menu"
      >
        {moves && item("move", "Move")}
        {canTrash && item("trash", "Move to trash")}
      </div>
    </>
  );
}

/**
 * The dialog of the action picked, over the page and outside the app bar,
 * whose styles would reach it.
 */
export function ActionDialog({
  action,
  file,
  page,
  path,
  onClose,
}: {
  action: Action;
  file: FileMetadata;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
  onClose: () => void;
}) {
  return createPortal(
    action === "move" ? (
      <MoveDialog file={file} page={page} onClose={onClose} />
    ) : (
      <Trash file={file} path={path} onClose={onClose} />
    ),
    document.body,
  );
}

/**
 * Moves the file to Drive's trash once the user confirms, then leaves it, but
 * in a tab opened from Drive, which holds the file alone: its page then says
 * where the file went.
 */
function Trash({
  file,
  path,
  onClose,
}: {
  file: FileMetadata;
  path: Crumb[] | undefined;
  onClose: () => void;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const stays = openedFromDrive();
  const trash = useMutation({
    mutationFn: () => drive.trashFile(file),
    onSuccess: () => {
      if (stays) setTrashed(client, file);
      refreshAfterChange(client, file, { leaving: !stays });
    },
  });
  return (
    <ConfirmDialog
      title="Move to trash?"
      action="Move to trash"
      pending={trash.isPending}
      error={trash.error}
      onConfirm={() => {
        renew();
        // Only while the page shows: Back takes the user elsewhere.
        trash.mutate(undefined, {
          onSuccess: () => {
            if (stays) onClose();
            else leave(file, path);
          },
        });
      }}
      onClose={onClose}
    >
      <p>
        {file.name} goes to Google Drive's trash, from which it can be restored.
      </p>
    </ConfirmDialog>
  );
}

/**
 * Goes back to the folder the file sat in: along the path taken, or else to
 * its parent, or Home when it has none.
 */
function leave(file: FileMetadata, path: Crumb[] | undefined): void {
  const folder = path?.at(-2);
  const [parent] = file.parents;
  // The user trashed the note: its unsaved changes go with it.
  const asked = { asked: true };
  if (folder) navigate(folder.href, path?.slice(0, -1), asked);
  else if (parent) {
    navigate(
      hrefOf({ name: "folder", folder: { id: parent } }),
      undefined,
      asked,
    );
  } else navigate(HOME, undefined, asked);
}
