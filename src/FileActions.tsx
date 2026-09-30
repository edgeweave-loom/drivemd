import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog, NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { isMarkdown, type FileMetadata, type FileRef } from "./drive.ts";
import { refreshAfterChange } from "./queries.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";
import { useVaultCheck } from "./vaults.ts";

const HOME = hrefOf({ name: "home" });

/** What the user may do with the file, as far as Drive allows. */
export function FileActions({
  file,
  page,
  path,
}: {
  file: FileMetadata;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
}) {
  const { canRename, canTrash } = file.capabilities;
  if (!canRename && !canTrash) return null;
  return (
    <div className="actions">
      {canRename && <Rename file={file} page={page} path={path} />}
      {canTrash && <Trash file={file} path={path} />}
    </div>
  );
}

const VAULT_NOTES = {
  checking: "Checking whether this note is in an Obsidian vault…",
  "in-vault":
    "This note is in an Obsidian vault. Links to it in other notes will not be updated: Obsidian updates them only when it renames a note itself.",
  unknown:
    "DriveMD could not check whether this note is in an Obsidian vault. If it is, links to it in other notes will not be updated.",
  outside: undefined,
};

/**
 * Renames the file, warning first when links in a vault point to it: the
 * rename waits for the vault check.
 */
function Rename({
  file,
  page,
  path,
}: {
  file: FileMetadata;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const vault = useVaultCheck(page, asking);
  const rename = useMutation({
    mutationFn: (name: string) => drive.renameFile(file, name),
    onSuccess: () => {
      refreshAfterChange(client, file);
    },
  });
  const note = VAULT_NOTES[vault];
  return (
    <>
      <button
        type="button"
        onClick={() => {
          rename.reset();
          setAsking(true);
        }}
      >
        Rename
      </button>
      {asking && (
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
                navigate(
                  href,
                  trail && [...trail, { name: renamed.name, href }],
                );
                setAsking(false);
              },
            });
          }}
          onClose={() => {
            setAsking(false);
          }}
        >
          {note && (
            <p className={vault === "checking" ? "hint" : "warning"}>{note}</p>
          )}
        </NameDialog>
      )}
    </>
  );
}

/** Moves the file to Drive's trash once the user confirms, then leaves it. */
function Trash({
  file,
  path,
}: {
  file: FileMetadata;
  path: Crumb[] | undefined;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const trash = useMutation({
    mutationFn: () => drive.trashFile(file),
    onSuccess: () => {
      refreshAfterChange(client, file, { leaving: true });
    },
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          trash.reset();
          setAsking(true);
        }}
      >
        Move to trash
      </button>
      {asking && (
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
          onClose={() => {
            setAsking(false);
          }}
        >
          <p>
            {file.name} goes to Google Drive's trash, from which it can be
            restored.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Goes back to the folder the file sat in: along the path taken, or else to
 * its parent, or Home when it has none.
 */
function leave(file: FileMetadata, path: Crumb[] | undefined): void {
  const folder = path?.at(-2);
  const [parent] = file.parents;
  if (folder) navigate(folder.href, path?.slice(0, -1));
  else if (parent) navigate(hrefOf({ name: "folder", folder: { id: parent } }));
  else navigate(HOME);
}
