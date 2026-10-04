import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { useDrive } from "./drive-context.ts";
import { FOLDER, type FileRef } from "./drive.ts";
import { CreateFile } from "./FolderPage.tsx";
import { Link } from "./Link.tsx";
import { Loaded } from "./Loaded.tsx";
import { usePath } from "./path.ts";
import { metadataQuery } from "./queries.ts";
import { hrefOf, navigate } from "./router.ts";

const TITLE = "New Markdown file";

/**
 * Drive's New: asks for the name of a Markdown file to create in the folder,
 * then opens the file in its place, or the folder if the user gives up.
 */
export function NewPage({ folder }: { folder: FileRef }) {
  const { drive } = useDrive();
  const details = useQuery(metadataQuery(drive, folder));
  const path = usePath(folder, undefined);
  const inFolder = hrefOf({ name: "folder", folder });
  const here = { name: TITLE, href: hrefOf({ name: "new", folder }) };
  return (
    <>
      <Breadcrumbs path={path && [...path, here]} />
      <h2>{TITLE}</h2>
      <Loaded
        query={details}
        missing="This folder does not exist, or it is not shared with you."
      >
        {(metadata) => {
          if (metadata.mimeType !== FOLDER) return <p>This is not a folder.</p>;
          if (!metadata.capabilities.canAddChildren) {
            return (
              <p>
                You cannot add files to this folder.{" "}
                <Link to={inFolder} trail={path}>
                  Open the folder
                </Link>
              </p>
            );
          }
          return (
            <CreateFile
              folder={folder}
              path={path}
              replace
              onClose={() => {
                navigate(inFolder, path, { replace: true });
              }}
            />
          );
        }}
      </Loaded>
    </>
  );
}
