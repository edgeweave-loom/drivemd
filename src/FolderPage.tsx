import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import { FOLDER, type FileRef } from "./drive.ts";
import { EntryList } from "./EntryList.tsx";
import { entriesOf } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import type { Crumb } from "./router.ts";

export function FolderPage({
  folder,
  trail,
}: {
  folder: FileRef;
  trail: Crumb[] | undefined;
}) {
  const { drive } = useDrive();
  const key = [folder.id, folder.resourceKey];
  // The path the user took names the folder as they reached it, such as by a
  // shortcut's own name; without it, Drive names it.
  const named = trail?.at(-1)?.name;
  const details = useQuery({
    queryKey: ["metadata", ...key],
    queryFn: () => drive.getMetadata(folder),
    enabled: named === undefined,
  });
  const children = useQuery({
    queryKey: ["children", ...key],
    queryFn: () => drive.listChildren(folder),
  });
  const name = named ?? details.data?.name;

  if (details.data && details.data.mimeType !== FOLDER) {
    return (
      <>
        <h2>{name}</h2>
        <p>This is not a folder.</p>
      </>
    );
  }
  return (
    <>
      <h2>{name ?? (details.isError ? "Folder" : "…")}</h2>
      <Loaded
        query={children}
        missing="This folder does not exist, or it is not shared with you."
      >
        {(items) => (
          <EntryList
            entries={entriesOf(items)}
            trail={trail}
            empty="No folders or Markdown files here."
          />
        )}
      </Loaded>
    </>
  );
}
