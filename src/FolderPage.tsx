import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import { FOLDER, type FileRef } from "./drive.ts";
import { ItemListing } from "./EntryList.tsx";
import { usePath } from "./path.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";

export function FolderPage({
  folder,
  trail,
}: {
  folder: FileRef;
  trail: Crumb[] | undefined;
}) {
  const { drive } = useDrive();
  const key = [folder.id, folder.resourceKey];
  // Says whether the user may add files, and names a folder reached without
  // a path.
  const details = useQuery({
    queryKey: ["metadata", ...key],
    queryFn: () => drive.getMetadata(folder),
  });
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
        queryKey={["children", ...key]}
        list={() => drive.listChildren(folder)}
        trail={path}
        missing="This folder does not exist, or it is not shared with you."
        empty="No folders or Markdown files here."
      />
    </>
  );
}

/** Creates a Markdown file in the folder, named first, then opens it. */
function NewFile({
  folder,
  path,
}: {
  folder: FileRef;
  path: Crumb[] | undefined;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const create = useMutation({
    mutationFn: (name: string) => drive.createFile(folder, name),
    onSuccess: () => {
      // The new file shows in the folder's list and in searches.
      void client.invalidateQueries({ queryKey: ["children"] });
      void client.invalidateQueries({ queryKey: ["search"] });
    },
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          create.reset();
          setAsking(true);
        }}
      >
        New
      </button>
      {asking && (
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
                navigate(href, path && [...path, { name: file.name, href }]);
              },
            });
          }}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
