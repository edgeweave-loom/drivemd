import { useDrive } from "./drive-context.ts";
import type { FileRef } from "./drive.ts";
import { ItemListing } from "./EntryList.tsx";
import { Link } from "./Link.tsx";
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
          {crumb.name}
        </Link>
      )}
      <ItemListing
        queryKey={["children", folder.id, folder.resourceKey]}
        list={() => drive.listChildren(folder)}
        trail={path}
        current={current}
        empty="No folders or Markdown files here."
      />
    </>
  );
}
