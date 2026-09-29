import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { isMarkdown, type FileMetadata, type FileRef } from "./drive.ts";
import { Link } from "./Link.tsx";
import { kindOf } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { usePath } from "./path.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";
import { useVaultCheck } from "./vaults.ts";

const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** A Markdown file, as its address names it. */
export function FilePage({
  file,
  trail,
}: {
  file: FileRef;
  trail: Crumb[] | undefined;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const { id, resourceKey } = file;
  const details = useQuery({
    queryKey: ["metadata", id, resourceKey],
    queryFn: () => drive.getMetadata(file),
  });
  const path = usePath(file, trail);
  const opens = details.data !== undefined && opensHere(details.data);

  useEffect(() => {
    if (!opens) return;
    // Recent sorts by it; a failure must not keep the file from opening.
    drive.markViewed({ id, resourceKey }).then(
      () =>
        client.invalidateQueries({ queryKey: ["recent"], refetchType: "none" }),
      () => undefined,
    );
  }, [drive, client, id, resourceKey, opens]);

  return (
    <>
      <Breadcrumbs path={path} />
      <div className="heading">
        <h2>
          {path?.at(-1)?.name ??
            details.data?.name ??
            (details.isError ? "File" : "…")}
        </h2>
        {opens && details.data.capabilities.canRename && (
          <Rename file={details.data} page={file} path={path} />
        )}
      </div>
      <Loaded
        query={details}
        missing="This file does not exist, or it is not shared with you."
      >
        {(metadata) => <About file={metadata} path={path} />}
      </Loaded>
    </>
  );
}

/** Whether the page opens the file: a Markdown file, out of the trash. */
function opensHere(file: FileMetadata): boolean {
  return !file.trashed && !file.target && kindOf(file) === "file";
}

function About({
  file,
  path,
}: {
  file: FileMetadata;
  path: Crumb[] | undefined;
}) {
  if (file.trashed) {
    return (
      <p>This file is in the trash. Restore it from Google Drive to open it.</p>
    );
  }
  const kind = kindOf(file);
  if (kind === undefined) return <p>DriveMD opens Markdown files only.</p>;
  if (file.target || kind === "folder") {
    const opens = file.target ?? file;
    const href = hrefOf(
      kind === "folder"
        ? { name: "folder", folder: opens }
        : { name: "file", file: opens },
    );
    // The path ends at what this page names, which the link replaces.
    const trail = path && [...path.slice(0, -1), { name: file.name, href }];
    return file.target ? (
      <p>
        This is a shortcut.{" "}
        <Link to={href} trail={trail}>
          Open what it points to
        </Link>
      </p>
    ) : (
      <p>
        This is a folder.{" "}
        <Link to={href} trail={trail}>
          Open the folder
        </Link>
      </p>
    );
  }
  return <Changed file={file} />;
}

/** Who changed the file last, and when, as far as Drive says. */
function Changed({ file }: { file: FileMetadata }) {
  const date = new Date(file.modifiedTime ?? Number.NaN);
  if (Number.isNaN(date.getTime())) return null;
  const when = WHEN.format(date);
  return (
    <p className="hint">
      {file.lastModifiedBy === undefined
        ? `Last modified on ${when}`
        : `Last modified by ${file.lastModifiedBy} on ${when}`}
    </p>
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
      // The name shows in lists, searches, breadcrumbs and this page.
      for (const queryKey of [
        ["metadata", file.id],
        ["climb"],
        ["children"],
        ["search"],
        ["recent"],
      ]) {
        void client.invalidateQueries({ queryKey });
      }
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
