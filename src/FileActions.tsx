import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { Icon } from "./Icon.tsx";
import { MoveDialog } from "./Move.tsx";
import {
  isMarkdown,
  mayMove,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { refreshAfterChange } from "./queries.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";
import { useVaultCheck, vaultNote } from "./vaults.ts";

const HOME = hrefOf({ name: "home" });

/** What the user may pick to do with a note. */
export type Action = "rename" | "move" | "trash";

/**
 * What the user may do with the file, as far as Drive allows, in a menu that
 * closes as an action's dialog opens.
 */
export function MoreActions({
  file,
  onPick,
}: {
  file: FileMetadata;
  onPick: (action: Action) => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const { canRename, canTrash } = file.capabilities;
  const moves = mayMove(file);
  if (!canRename && !moves && !canTrash) return null;
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
        {canRename && item("rename", "Rename")}
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
    action === "rename" ? (
      <Rename file={file} page={page} path={path} onClose={onClose} />
    ) : action === "move" ? (
      <MoveDialog file={file} page={page} onClose={onClose} />
    ) : (
      <Trash file={file} path={path} onClose={onClose} />
    ),
    document.body,
  );
}

/**
 * Renames the file, warning first when links in a vault point to it: the
 * rename waits for the vault check.
 */
function Rename({
  file,
  page,
  path,
  onClose,
}: {
  file: FileMetadata;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
  onClose: () => void;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const vault = useVaultCheck(page, true);
  const rename = useMutation({
    mutationFn: (name: string) => drive.renameFile(file, name),
    onSuccess: () => {
      refreshAfterChange(client, file);
    },
  });
  const note = vaultNote(vault, "renames");
  return (
    <NameDialog
      title="Rename"
      initial={file.name}
      hint={(name) =>
        isMarkdown(name.trim())
          ? undefined
          : "Without .md or .markdown at the end, DriveMD will no longer list this file."
      }
      action="Rename"
      pending={rename.isPending}
      ready={vault !== "checking"}
      error={rename.error}
      onSubmit={(name) => {
        renew();
        // Only while the page shows: Back takes the user elsewhere.
        rename.mutate(name, {
          onSuccess: (renamed) => {
            const href = hrefOf({ name: "file", file: renamed });
            const trail = path?.slice(0, -1);
            navigate(href, trail && [...trail, { name: renamed.name, href }]);
            onClose();
          },
        });
      }}
      onClose={onClose}
    >
      {note && (
        <p className={vault === "checking" ? "hint" : "warning"}>{note}</p>
      )}
    </NameDialog>
  );
}

/** Moves the file to Drive's trash once the user confirms, then leaves it. */
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
  const trash = useMutation({
    mutationFn: () => drive.trashFile(file),
    onSuccess: () => {
      refreshAfterChange(client, file, { leaving: true });
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
            leave(file, path);
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
