import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import {
  MY_DRIVE,
  type DriveItem,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { describeError } from "./errors.ts";
import { entriesOf } from "./listing.ts";
import { Loaded } from "./Loaded.tsx";
import { refreshAfterChange } from "./queries.ts";
import { ROOTS } from "./roots.ts";
import { hrefOf, navigate, routeOf, type Crumb } from "./router.ts";
import { useVaultCheck, vaultNote } from "./vaults.ts";

/**
 * A place the picker opens: a root, or a folder to move into. `id` tells
 * apart two ways to the same place, such as a folder and a shortcut to it.
 */
type Spot =
  | {
      kind: "shortcuts" | "shared-drives" | "shared-with-me";
      id: string;
      crumb: Crumb;
    }
  | {
      kind: "folder";
      id: string;
      crumb: Crumb;
      folder: FileRef;
      /** Whether a shortcut, named by whoever made it, leads there. */
      shortcut?: boolean;
    };

/** Where the picker stands: above every drive, or at a spot. */
type Stop = { kind: "all-drives" } | Spot;

const ALL_DRIVES: Stop = { kind: "all-drives" };
const ROOT_SPOTS: Spot[] = [
  {
    kind: "folder",
    id: MY_DRIVE,
    crumb: ROOTS.myDrive,
    folder: { id: MY_DRIVE },
  },
  { kind: "shortcuts", id: "shortcuts", crumb: ROOTS.shortcuts },
  { kind: "shared-drives", id: "shared-drives", crumb: ROOTS.sharedDrives },
  { kind: "shared-with-me", id: "shared-with-me", crumb: ROOTS.sharedWithMe },
];

/** Moves the file into a folder the user picks, from where it is. */
export function Move({
  file,
  page,
  path,
}: {
  file: FileMetadata;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAsking(true);
        }}
      >
        Move
      </button>
      {asking && (
        <MoveDialog
          file={file}
          page={page}
          path={path}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}

function MoveDialog({
  file,
  page,
  path,
  onClose,
}: {
  file: FileMetadata;
  page: FileRef;
  path: Crumb[] | undefined;
  onClose: () => void;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  // Where the file sits, along the path taken, to start from.
  const [{ above, here }, setPlace] = useState(() => {
    const spots: Stop[] = path?.slice(0, -1).flatMap(spotOf) ?? [];
    const last = spots.pop();
    return last
      ? { above: [ALL_DRIVES, ...spots], here: last }
      : { above: [], here: ALL_DRIVES };
  });
  const vault = useVaultCheck(page, true);
  const folder = here.kind === "folder" ? here.folder : undefined;
  const target = useQuery({
    queryKey: ["metadata", folder?.id, folder?.resourceKey],
    queryFn: folder ? () => drive.getMetadata(folder) : skipToken,
  });
  const move = useMutation({
    mutationFn: (to: FileRef) => drive.moveFile(file, to),
    onSuccess: (moved) => {
      // Another move must start from the file's new folder, even before
      // Drive's details come back.
      client.setQueriesData<FileMetadata>(
        { queryKey: ["metadata", file.id] },
        (before) => before && { ...before, parents: moved.parents },
      );
      refreshAfterChange(client, file);
    },
  });
  const go = (place: { above: Stop[]; here: Stop }) => {
    move.reset();
    setPlace(place);
  };
  const refusal =
    folder === undefined
      ? "Choose a folder."
      : target.error
        ? describeError(
            target.error,
            "This folder does not exist, or it is not shared with you.",
          )
        : target.data && refusalOf(file, target.data);
  const note = vaultNote(vault, "moves");
  // Where the file may go, once Drive has said whether it may.
  const destination =
    target.data && !refusal && vault !== "checking" ? folder : undefined;

  return (
    <ConfirmDialog
      title={`Move ${file.name}`}
      action="Move here"
      pending={move.isPending}
      error={move.error}
      onConfirm={
        destination &&
        (() => {
          renew();
          // Only while the page shows: Back takes the user elsewhere.
          move.mutate(destination, {
            onSuccess: () => {
              const href = hrefOf({ name: "file", file: page });
              const trail = [...above, here].flatMap((stop) =>
                stop.kind === "all-drives" ? [] : [stop.crumb],
              );
              navigate(href, [...trail, { name: file.name, href }]);
              onClose();
            },
          });
        })
      }
      onClose={onClose}
    >
      {/* Where the file goes stays put while Drive moves it. */}
      <fieldset className="picker" disabled={move.isPending}>
        <nav aria-label="Folders above" className="crumbs">
          <ol>
            {above.map((stop, index) => (
              // A path cut short can hold the same folder twice.
              <li key={index}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    go({ above: above.slice(0, index), here: stop });
                  }}
                >
                  {nameOf(stop)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <h3>{nameOf(here)}</h3>
        <SpotList
          spot={here}
          onOpen={(next) => {
            go({ above: [...above, here], here: next });
          }}
        />
      </fieldset>
      {refusal && <p className="hint">{refusal}</p>}
      {note && (
        <p className={vault === "checking" ? "hint" : "warning"}>{note}</p>
      )}
    </ConfirmDialog>
  );
}

/** Why the file cannot move into the folder, if it cannot. */
function refusalOf(
  file: FileMetadata,
  folder: FileMetadata,
): string | undefined {
  if (file.parents.includes(folder.id)) return `${file.name} is already here.`;
  if (!folder.capabilities.canAddChildren) {
    return "You cannot add files to this folder.";
  }
  const { canMoveItemWithinDrive, canMoveItemOutOfDrive } = file.capabilities;
  if (folder.driveId === file.driveId) {
    return canMoveItemWithinDrive
      ? undefined
      : `${file.name} cannot move within its drive.`;
  }
  return canMoveItemOutOfDrive
    ? undefined
    : `${file.name} cannot leave the drive it is in.`;
}

function nameOf(stop: Stop): string {
  return stop.kind === "all-drives" ? "All drives" : stop.crumb.name;
}

/** The folders, or roots, the picker can open from where it stands. */
function SpotList({
  spot,
  onOpen,
}: {
  spot: Stop;
  onOpen: (spot: Spot) => void;
}) {
  switch (spot.kind) {
    case "all-drives":
      return <Spots spots={ROOT_SPOTS} onOpen={onOpen} />;
    case "shared-drives":
      return <SharedDriveSpots onOpen={onOpen} />;
    default:
      return <FolderSpots spot={spot} onOpen={onOpen} />;
  }
}

function SharedDriveSpots({ onOpen }: { onOpen: (spot: Spot) => void }) {
  const { drive } = useDrive();
  const drives = useQuery({
    queryKey: ["shared-drives"],
    queryFn: drive.listSharedDrives,
  });
  return (
    <Loaded query={drives}>
      {(found) => (
        <Spots
          // A shared drive's ID is also its top folder's.
          spots={found.map(({ id, name }) => ({
            kind: "folder",
            id,
            crumb: { name, href: hrefOf({ name: "folder", folder: { id } }) },
            folder: { id },
          }))}
          onOpen={onOpen}
        />
      )}
    </Loaded>
  );
}

/** The folders in a folder, among the user's shortcuts, or shared with them. */
function FolderSpots({
  spot,
  onOpen,
}: {
  spot: Exclude<Spot, { kind: "shared-drives" }>;
  onOpen: (spot: Spot) => void;
}) {
  const { drive } = useDrive();
  // The same lists as the navigator's pages, so they share Drive's answers.
  const items = useQuery({
    ...(spot.kind === "folder"
      ? {
          queryKey: ["children", spot.folder.id, spot.folder.resourceKey],
          queryFn: () => drive.listChildren(spot.folder),
        }
      : spot.kind === "shortcuts"
        ? { queryKey: ["shortcuts"], queryFn: drive.listShortcuts }
        : { queryKey: ["shared-with-me"], queryFn: drive.listSharedWithMe }),
    select: foldersOf,
  });
  return (
    <Loaded query={items}>
      {(found) => <Spots spots={found} onOpen={onOpen} />}
    </Loaded>
  );
}

function Spots({
  spots,
  onOpen,
}: {
  spots: Spot[];
  onOpen: (spot: Spot) => void;
}) {
  if (spots.length === 0) return <p className="hint">No folders here.</p>;
  return (
    <ul className="entries">
      {spots.map((next) => (
        <li key={next.id}>
          <button
            type="button"
            className="entry folder"
            onClick={() => {
              onOpen(next);
            }}
          >
            <span className="name">{next.crumb.name}</span>
            {next.kind === "folder" && next.shortcut && (
              <span className="badge">Shortcut</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The folders among the items, and the shortcuts to them. */
function foldersOf(items: DriveItem[]): Spot[] {
  return entriesOf(items)
    .filter(({ kind }) => kind === "folder")
    .map(({ id, name, opens, target }) => ({
      kind: "folder",
      id,
      crumb: { name, href: hrefOf({ name: "folder", folder: opens }) },
      folder: opens,
      shortcut: target !== undefined,
    }));
}

/** The picker's spot for a step of the path taken, if it is a place. */
function spotOf(crumb: Crumb): Spot[] {
  const route = routeOf(new URL(crumb.href, window.location.origin));
  switch (route.name) {
    case "folder":
      return [
        { kind: "folder", id: route.folder.id, crumb, folder: route.folder },
      ];
    case "shortcuts":
    case "shared-drives":
    case "shared-with-me":
      return [{ kind: route.name, id: route.name, crumb }];
    default:
      return [];
  }
}
