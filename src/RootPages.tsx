import { useQuery, type QueryKey } from "@tanstack/react-query";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { useDrive } from "./drive-context.ts";
import type { DriveItem } from "./drive.ts";
import { EntryList, ItemListing } from "./EntryList.tsx";
import { inOrder } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { ROOTS } from "./roots.ts";
import type { Crumb } from "./router.ts";

const MISSING = "Google Drive could not find this list.";

/** The shortcuts the user made, wherever they are. */
export function ShortcutsPage({ trail }: { trail: Crumb[] | undefined }) {
  const { drive } = useDrive();
  return (
    <RootListing
      root={ROOTS.shortcuts}
      trail={trail}
      queryKey={["shortcuts"]}
      list={drive.listShortcuts}
      empty="No shortcuts to folders or Markdown files. Make them in Google Drive."
    />
  );
}

export function SharedWithMePage({ trail }: { trail: Crumb[] | undefined }) {
  const { drive } = useDrive();
  return (
    <RootListing
      root={ROOTS.sharedWithMe}
      trail={trail}
      queryKey={["shared-with-me"]}
      list={drive.listSharedWithMe}
      empty="No folders or Markdown files are shared with you."
    />
  );
}

/** A root that lists items, which starts the path taken from it. */
function RootListing({
  root,
  trail,
  queryKey,
  list,
  empty,
}: {
  root: Crumb;
  trail: Crumb[] | undefined;
  queryKey: QueryKey;
  list: () => Promise<DriveItem[]>;
  empty: string;
}) {
  return (
    <>
      <Breadcrumbs path={[root]} />
      <h2>{root.name}</h2>
      <ItemListing
        queryKey={queryKey}
        list={list}
        trail={trail ?? [root]}
        missing={MISSING}
        empty={empty}
      />
    </>
  );
}

export function SharedDrivesPage({ trail }: { trail: Crumb[] | undefined }) {
  const { drive } = useDrive();
  const drives = useQuery({
    queryKey: ["shared-drives"],
    queryFn: drive.listSharedDrives,
  });
  return (
    <>
      <Breadcrumbs path={[ROOTS.sharedDrives]} />
      <h2>{ROOTS.sharedDrives.name}</h2>
      <Loaded query={drives} missing={MISSING}>
        {(found) => (
          <EntryList
            // A shared drive's ID is also its top folder's.
            entries={inOrder(
              found.map(({ id, name }) => ({
                kind: "folder",
                id,
                name,
                opens: { id },
                target: undefined,
              })),
            )}
            trail={trail ?? [ROOTS.sharedDrives]}
            empty="You are not a member of any shared drive."
          />
        )}
      </Loaded>
    </>
  );
}
