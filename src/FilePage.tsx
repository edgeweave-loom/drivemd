import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { useDrive } from "./drive-context.ts";
import type { FileMetadata, FileRef } from "./drive.ts";
import { Link } from "./Link.tsx";
import { kindOf } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { usePath } from "./path.ts";
import { hrefOf, type Crumb } from "./router.ts";

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
      <h2>
        {path?.at(-1)?.name ??
          details.data?.name ??
          (details.isError ? "File" : "…")}
      </h2>
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
