import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { Dialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import type { FileMetadata, FileRef } from "./drive.ts";
import { FileActions } from "./FileActions.tsx";
import { FolderPane } from "./FolderPane.tsx";
import { Link } from "./Link.tsx";
import { kindOf } from "./listing.ts";
import { useLayout } from "./layout.ts";
import { Loaded } from "./Loaded.tsx";
import { Missing } from "./Missing.tsx";
import { usePath } from "./path.ts";
import { metadataQuery, refreshRecent } from "./queries.ts";
import { hrefOf, routeOf, type Crumb } from "./router.ts";

// The viewer loads with the first file opened, not with the navigator. When
// it cannot, as when the connection dropped or a new release replaced it,
// the page says so rather than the app failing as a whole.
const FileContent = lazy(() =>
  import("./FileContent.tsx").then(
    ({ FileContent }) => ({ default: FileContent }),
    () => ({ default: ViewerMissing }),
  ),
);

function ViewerMissing() {
  return <Missing part="viewer" />;
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * A file's page, with the folder it sits in beside it on a wide screen or in
 * a drawer on a tablet. The folder stays as another of its files opens.
 */
export function FileView({
  file,
  trail,
}: {
  file: FileRef;
  trail: Crumb[] | undefined;
}) {
  const layout = useLayout();
  const { drive } = useDrive();
  // The folder stays in view while another of its files loads.
  const details = useQuery({
    ...metadataQuery(drive, file),
    placeholderData: keepPreviousData,
  });
  const path = usePath(file, trail);
  const folder =
    layout !== "phone" && details.data && opensHere(details.data)
      ? folderOf(path)
      : undefined;
  const pane = folder && (
    <FolderPane
      key={folder.ref.id}
      folder={folder.ref}
      path={folder.path}
      current={file.id}
    />
  );
  return (
    <div className="split">
      {pane && layout === "wide" && (
        <aside className="pane" aria-label={folder.name}>
          {pane}
        </aside>
      )}
      <FilePage
        key={file.id}
        file={file}
        trail={trail}
        drawer={
          pane &&
          layout === "tablet" && (
            <FolderDrawer name={folder.name}>{pane}</FolderDrawer>
          )
        }
      />
    </div>
  );
}

/** The folder the path ends in, above the file, if it is one. */
function folderOf(path: Crumb[] | undefined) {
  const above = path?.slice(0, -1) ?? [];
  const parent = above.at(-1);
  if (!parent) return;
  const route = routeOf(new URL(parent.href, window.location.origin));
  if (route.name !== "folder") return;
  return { ref: route.folder, name: parent.name, path: above };
}

/** The folder's list, in a drawer the user opens and closes with a tap. */
function FolderDrawer({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Folder
      </button>
      {open && (
        <Dialog title={name} className="drawer" onClose={close}>
          <div className="stack">
            {children}
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** A Markdown file, as its address names it. */
export function FilePage({
  file,
  trail,
  drawer,
}: {
  file: FileRef;
  trail: Crumb[] | undefined;
  /** Where to find the file's folder, when not beside it. */
  drawer?: ReactNode;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const { id, resourceKey } = file;
  const details = useQuery(metadataQuery(drive, file));
  const path = usePath(file, trail);
  const opens = details.data !== undefined && opensHere(details.data);

  useEffect(() => {
    if (!opens) return;
    // Recent sorts by it; a failure must not keep the file from opening.
    drive.markViewed({ id, resourceKey }).then(
      () => refreshRecent(client),
      () => undefined,
    );
  }, [drive, client, id, resourceKey, opens]);

  return (
    <div className="main">
      <Breadcrumbs path={path} />
      <div className="heading">
        <h2>
          {path?.at(-1)?.name ??
            details.data?.name ??
            (details.isError ? "File" : "…")}
        </h2>
        {drawer}
        {opens && <FileActions file={details.data} page={file} path={path} />}
      </div>
      <Loaded
        query={details}
        missing="This file does not exist, or it is not shared with you."
      >
        {(metadata) => <About file={metadata} path={path} />}
      </Loaded>
    </div>
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
  return (
    <>
      <Changed file={file} />
      <Suspense fallback={<p className="hint">Loading…</p>}>
        <FileContent file={file} />
      </Suspense>
    </>
  );
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
