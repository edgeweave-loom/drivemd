import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { FOLDER, type FileRef } from "./drive.ts";
import { ItemListing } from "./EntryList.tsx";
import { Icon } from "./Icon.tsx";
import { usePath } from "./path.ts";
import { childrenQuery, metadataQuery, refreshAfterChange } from "./queries.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";

export function FolderPage({
  folder,
  trail,
}: {
  folder: FileRef;
  trail: Crumb[] | undefined;
}) {
  const { drive } = useDrive();
  // Says whether the user may add files, and names a folder reached without
  // a path.
  const details = useQuery(metadataQuery(drive, folder));
  const path = usePath(folder, trail);
  const name = path?.at(-1)?.name ?? details.data?.name;

  if (details.data && details.data.mimeType !== FOLDER) {
    return (
      <>
        <Breadcrumbs path={path} />
        <h2>{name}</h2>
        <p>This is not a folder.</p>
      </>
    );
  }
  return (
    <>
      <Breadcrumbs path={path} />
      <div className="heading">
        <h2>{name ?? (details.isError ? "Folder" : "…")}</h2>
        {details.data?.capabilities.canAddChildren && (
          <NewFile folder={folder} path={path} />
        )}
      </div>
      <ItemListing
        query={childrenQuery(drive, folder)}
        trail={path}
        missing="This folder does not exist, or it is not shared with you."
        empty="No folders or Markdown files here."
      />
    </>
  );
}

/** Offers to create a Markdown file in the folder. */
function NewFile({
  folder,
  path,
}: {
  folder: FileRef;
  path: Crumb[] | undefined;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      {/* Tonal beside the folder's name, floating on a phone. */}
      <button
        type="button"
        className="tonal new-note"
        onClick={() => {
          setAsking(true);
        }}
      >
        <Icon name="add" />
        New note
      </button>
      {asking && (
        <CreateFile
          folder={folder}
          path={path}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}

/** Asks for a Markdown file's name, creates it in the folder, then opens it. */
export function CreateFile({
  folder,
  path,
  replace = false,
  onClose,
  children,
}: {
  folder: FileRef;
  path: Crumb[] | undefined;
  /** Whether the file's page takes the place of the page shown. */
  replace?: boolean;
  onClose: () => void;
  /** Anything else to know before creating it. */
  children?: ReactNode;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: (name: string) => drive.createFile(folder, name),
    onSuccess: (file) => {
      refreshAfterChange(client, file);
    },
  });
  return (
    <NameDialog
      title="New Markdown file"
      initial="Untitled"
      hint={() => ".md is added unless the name ends in .md or .markdown."}
      action="Create"
      pending={create.isPending}
      error={create.error}
      onSubmit={(name) => {
        renew();
        // Only while the page shows: Back takes the user elsewhere.
        create.mutate(name, {
          onSuccess: (file) => {
            const href = hrefOf({ name: "file", file });
            const trail = path && [...path, { name: file.name, href }];
            navigate(href, trail, { replace });
          },
        });
      }}
      onClose={onClose}
    >
      {children}
    </NameDialog>
  );
}
