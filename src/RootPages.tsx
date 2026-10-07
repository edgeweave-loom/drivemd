import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { useDrive } from "./drive-context.ts";
import type { DriveItem } from "./drive.ts";
import { EntryList, ItemListing } from "./EntryList.tsx";
import { inOrder } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import {
  sharedDrivesQuery,
  sharedWithMeQuery,
  shortcutsQuery,
} from "./queries.ts";
import { ROOTS } from "./roots.ts";
import type { Crumb } from "./router.ts";

/** The shortcuts the user made, wherever they are. */
export function ShortcutsPage({ trail }: { trail: Crumb[] | undefined }) {
  const { drive } = useDrive();
  return (
    <RootListing
      root={ROOTS.shortcuts}
      trail={trail}
      query={shortcutsQuery(drive)}
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
      query={sharedWithMeQuery(drive)}
      empty="No folders or Markdown files are shared with you."
    />
  );
}

/** A root that lists items, which starts the path taken from it. */
function RootListing<Key extends QueryKey>({
  root,
  trail,
  query,
  empty,
}: {
  root: Crumb;
  trail: Crumb[] | undefined;
  query: UseQueryOptions<DriveItem[], Error, DriveItem[], Key>;
  empty: string;
}) {
  return (
    <>
      <Breadcrumbs path={[root]} />
      <h2>{root.name}</h2>
      <ItemListing query={query} trail={trail ?? [root]} empty={empty} />
    </>
  );
}

export function SharedDrivesPage({ trail }: { trail: Crumb[] | undefined }) {
  const { drive } = useDrive();
  const drives = useQuery(sharedDrivesQuery(drive));
  return (
    <>
      <Breadcrumbs path={[ROOTS.sharedDrives]} />
      <h2>{ROOTS.sharedDrives.name}</h2>
      <Loaded query={drives}>
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
                // Drive gives a shared drive no time of change.
                modifiedTime: undefined,
                modifiedBy: undefined,
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
