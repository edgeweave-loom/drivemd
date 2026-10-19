import { useDrive } from "./drive-context.ts";
import type { FileRef } from "./drive.ts";
import { ItemListing } from "./EntryList.tsx";
import { Icon } from "./Icon.tsx";
import { Link } from "./Link.tsx";
import { childrenQuery } from "./queries.ts";
import type { Crumb } from "./router.ts";

/**
 * The folder a file sits in, listed beside it on a wide screen or in a drawer
 * on a narrower one, so that another file is a tap away.
 */
export function FolderPane({
  folder,
  path,
  current,
  headed = false,
}: {
  folder: FileRef;
  /** The path to the folder, which it ends. */
  path: Crumb[];
  /** The file the page shows. */
  current: string;
  /** Whether what holds the list heads it with the folder already. */
  headed?: boolean;
}) {
  const { drive } = useDrive();
  return (
    <>
      {!headed && <FolderLink path={path} onward />}
      <ItemListing
        query={childrenQuery(drive, folder)}
        trail={path}
        current={current}
        empty="No folders or Markdown files here."
      />
    </>
  );
}

/** The folder the path ends in, which leads back to it. */
export function FolderLink({
  path,
  onward = false,
}: {
  path: Crumb[];
  /** Whether a chevron says that the link leads on. */
  onward?: boolean;
}) {
  const crumb = path.at(-1);
  if (!crumb) return null;
  return (
    <Link to={crumb.href} trail={path} className="entry folder">
      <Icon name="folder_open" />
      {crumb.name}
      {onward && <Icon name="chevron_right" />}
    </Link>
  );
}
