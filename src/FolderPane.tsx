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
}: {
  folder: FileRef;
  /** The path to the folder, which it ends. */
  path: Crumb[];
  /** The file the page shows. */
  current: string;
}) {
  const { drive } = useDrive();
  const crumb = path.at(-1);
  return (
    <>
      {crumb && (
        <Link to={crumb.href} trail={path} className="entry folder">
          <Icon name="folder_open" />
          {crumb.name}
          <Icon name="chevron_right" />
        </Link>
      )}
      <ItemListing
        query={childrenQuery(drive, folder)}
        trail={path}
        current={current}
        empty="No folders or Markdown files here."
      />
    </>
  );
}
