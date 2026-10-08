import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FilePage } from "./FilePage.tsx";
import { getPlace, usePlace } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
  shortcutItem,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { moreActions } from "./test/actions.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

function folder(name: string, id: string, parent: string, changes = {}) {
  const item = folderItem(name, { id, parents: [parent], ...changes });
  item.capabilities.canAddChildren = true;
  return metadata(item);
}

const MY_ROOT = folder("My Drive", "my-root", "my-root", { parents: [] });
const WORK = folder("Work", "work", "my-root");
const ARCHIVE = folder("Archive", "archive", "work");
const TEAM = folder("Team", "team", "team", { driveId: "team", parents: [] });
const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
  { name: "plan.md", href: "/edit?id=plan" },
];

function plan(changes: Partial<FileMetadata> = {}) {
  return metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }), {
    ...changes,
  });
}

function PlanPage() {
  const { trail } = usePlace();
  return <FilePage file={{ id: "plan" }} trail={trail} />;
}

function openPlan(file = plan(), vaults: FileMetadata[] = []) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(
    metadataOf(MY_ROOT, WORK, ARCHIVE, TEAM, file),
  );
  drive.markViewed.mockResolvedValue();
  drive.findVaultConfigs.mockResolvedValue(
    vaults.map(({ id }) =>
      folderItem(".obsidian", { id: `config-${id}`, parents: [id] }),
    ),
  );
  drive.listChildren.mockImplementation(({ id }) =>
    Promise.resolve(
      id === "work"
        ? [ARCHIVE, file, shortcutItem("Linked", "text/markdown")]
        : [],
    ),
  );
  drive.listSharedDrives.mockResolvedValue([{ id: "team", name: "Team" }]);
  drive.moveFile.mockImplementation((moved, to) =>
    Promise.resolve({ ...moved, parents: [to.id] }),
  );
  visit("/edit?id=plan", { trail: TRAIL });
  const rendered = renderWithDrive(<PlanPage />, drive);
  return { ...rendered, drive };
}

/** The places above the one the picker shows, which lead back to them. */
function namesAbove(picker: Awaited<ReturnType<typeof openPicker>>) {
  return within(picker.getByRole("navigation", { name: "Folders above" }))
    .queryAllByRole("button")
    .map((button) => button.textContent);
}

/** Opens the picker from More actions, where a phone keeps Move. */
async function openPicker() {
  fireEvent.click((await moreActions()).getByRole("button", { name: "Move" }));
  return within(screen.getByRole("dialog", { name: "Move plan.md" }));
}

afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("Move", () => {
  it("is offered only when Drive allows it", async () => {
    const file = plan();
    file.capabilities.canMoveItemWithinDrive = false;
    file.capabilities.canMoveItemOutOfDrive = false;
    openPlan(file);

    const menu = await moreActions();
    expect(menu.getByRole("button", { name: "Rename" })).toBeVisible();
    expect(menu.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("opens at the file's folder, listing only folders", async () => {
    openPlan();

    const picker = await openPicker();
    expect(await picker.findByRole("heading", { name: "Work" })).toBeVisible();
    expect(
      await picker.findByRole("button", { name: "Archive" }),
    ).toBeVisible();
    expect(picker.queryByRole("button", { name: /plan|Linked/ })).toBeNull();
    expect(picker.queryByRole("button", { name: /Shortcut/ })).toBeNull();
    expect(picker.getByText("plan.md is already here.")).toBeVisible();
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
  });

  it("moves the file into the folder chosen, keeping the path there", async () => {
    const { drive, renew } = openPlan();

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Archive" }));
    const here = picker.getByRole("button", { name: "Move here" });
    await waitFor(() => {
      expect(here).toBeEnabled();
    });
    fireEvent.click(here);
    expect(renew).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(drive.moveFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan" }),
      { id: "archive" },
    );
    expect(getPlace().trail).toEqual([
      ...TRAIL.slice(0, 2),
      { name: "Archive", href: "/folder/archive" },
      { name: "plan.md", href: "/edit?id=plan" },
    ]);
  });

  it("climbs back up to the roots, and into a shared drive", async () => {
    const file = plan();
    file.capabilities.canMoveItemOutOfDrive = false;
    openPlan(file);

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "All drives" }));
    fireEvent.click(picker.getByRole("button", { name: "Shared drives" }));
    fireEvent.click(await picker.findByRole("button", { name: "Team" }));
    expect(
      await picker.findByText("plan.md cannot leave the drive it is in."),
    ).toBeVisible();
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
    fireEvent.click(picker.getByRole("button", { name: "All drives" }));
    fireEvent.click(picker.getByRole("button", { name: "My Drive" }));
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
    });
  });

  it.each([
    [
      "through a shortcut",
      [
        { name: "Shortcuts", href: "/shortcuts" },
        { name: "Linked", href: "/folder/linked" },
      ],
    ],
    [
      "next to a shortcut to the file",
      [
        { name: "My Drive", href: "/my-drive" },
        { name: "Elsewhere", href: "/folder/elsewhere" },
      ],
    ],
    [
      "from Shared with me",
      [{ name: "Shared with me", href: "/shared-with-me" }],
    ],
    ["from a search", [{ name: "Search: plan", href: "/search?q=plan" }]],
    ["from Home", [{ name: "Home", href: "/" }]],
    ["from its address alone, as Drive opens it", undefined],
  ])(
    "opens at the folder the file sits in, reached %s",
    async (_how, above) => {
      openPlan();
      visit("/edit?id=plan", {
        trail: above && [...above, { name: "plan.md", href: "/edit?id=plan" }],
      });

      const picker = await openPicker();
      expect(
        await picker.findByRole("heading", { name: "Work" }),
      ).toBeVisible();
      expect(namesAbove(picker)).toEqual(["All drives", "My Drive"]);
      expect(picker.getByText("plan.md is already here.")).toBeVisible();
    },
  );

  it("opens in the shared drive the file sits in", async () => {
    const notes = folder("Notes", "notes", "team", { driveId: "team" });
    const { drive } = openPlan();
    drive.getMetadata.mockImplementation(
      metadataOf(TEAM, notes, plan({ parents: ["notes"], driveId: "team" })),
    );

    const picker = await openPicker();
    expect(await picker.findByRole("heading", { name: "Notes" })).toBeVisible();
    expect(namesAbove(picker)).toEqual(["All drives", "Shared drives", "Team"]);
  });

  it("opens at Shared with me when no folder above the file is in reach", async () => {
    const { drive } = openPlan();
    drive.getMetadata.mockImplementation(
      metadataOf(plan({ parents: ["hidden"] })),
    );
    drive.listSharedWithMe.mockResolvedValue([]);
    drive.listShortcuts.mockResolvedValue([]);

    const picker = await openPicker();
    expect(
      await picker.findByRole("heading", { name: "Shared with me" }),
    ).toBeVisible();
    expect(namesAbove(picker)).toEqual(["All drives"]);
    expect(await picker.findByText("No folders here.")).toBeVisible();
    expect(picker.getByText("Choose a folder.")).toBeVisible();
    fireEvent.click(picker.getByRole("button", { name: "All drives" }));
    fireEvent.click(picker.getByRole("button", { name: "Shortcuts" }));
    expect(await picker.findByText("No folders here.")).toBeVisible();
    expect(namesAbove(picker)).toEqual(["All drives"]);
  });

  it("opens at the folder the file went to, once moved", async () => {
    const { drive, client } = openPlan();
    // As in the app, where the path stays fresh unless a change says not.
    client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });

    let picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Archive" }));
    drive.getMetadata.mockImplementation(
      metadataOf(MY_ROOT, WORK, ARCHIVE, plan({ parents: ["archive"] })),
    );
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
    });
    fireEvent.click(picker.getByRole("button", { name: "Move here" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    picker = await openPicker();
    expect(
      await picker.findByRole("heading", { name: "Archive" }),
    ).toBeVisible();
    expect(namesAbove(picker)).toEqual(["All drives", "My Drive", "Work"]);
  });

  it("moves the file to another drive when Drive allows it", async () => {
    const { drive } = openPlan();

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "All drives" }));
    fireEvent.click(picker.getByRole("button", { name: "Shared drives" }));
    fireEvent.click(await picker.findByRole("button", { name: "Team" }));
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
    });
    fireEvent.click(picker.getByRole("button", { name: "Move here" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(drive.moveFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan" }),
      { id: "team" },
    );
    expect(getPlace().trail).toEqual([
      { name: "Shared drives", href: "/shared-drives" },
      { name: "Team", href: "/folder/team" },
      { name: "plan.md", href: "/edit?id=plan" },
    ]);
  });

  it("says why it cannot open a folder", async () => {
    const { drive } = openPlan();
    drive.listChildren.mockResolvedValue([
      shortcutItem("Gone", "application/vnd.google-apps.folder"),
    ]);

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: /^Gone/ }));
    expect(
      await picker.findByText(
        "This folder does not exist, or it is not shared with you.",
      ),
    ).toBeVisible();
  });

  it("lists twice a folder found twice", async () => {
    const error = vi.spyOn(console, "error");
    const { drive } = openPlan();
    drive.listChildren.mockResolvedValue([
      ARCHIVE,
      {
        ...shortcutItem("Archive", "application/vnd.google-apps.folder"),
        target: {
          id: "archive",
          mimeType: "application/vnd.google-apps.folder",
          resourceKey: undefined,
        },
      },
    ]);

    const picker = await openPicker();
    await waitFor(() => {
      expect(
        picker
          .getAllByRole("button", { name: /^Archive/ })
          .map((button) => button.textContent),
      ).toEqual(["Archive", "ArchiveShortcut"]);
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("stays put while Drive moves the file, and forgets a refusal elsewhere", async () => {
    const { drive } = openPlan();
    let refuse: (error: Error) => void = () => undefined;
    drive.moveFile.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
    });
    fireEvent.click(picker.getByRole("button", { name: "Move here" }));
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Work" })).toBeDisabled();
    });
    refuse(new DriveError(403, "Refused"));
    await picker.findByRole("alert");
    fireEvent.click(picker.getByRole("button", { name: "Work" }));
    expect(picker.queryByRole("alert")).toBeNull();
  });

  it("keeps a file Drive holds in place in its folder", async () => {
    const file = plan();
    file.capabilities.canMoveItemWithinDrive = false;
    openPlan(file);

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Archive" }));
    expect(
      await picker.findByText("plan.md cannot move within its drive."),
    ).toBeVisible();
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
  });

  it("waits for Drive to say where the file sits", async () => {
    const { drive } = openPlan();
    drive.getMetadata.mockImplementation((ref) =>
      ref.id === "work"
        ? new Promise(() => undefined)
        : metadataOf(MY_ROOT, plan())(ref),
    );

    const picker = await openPicker();
    expect(picker.getByText("Loading…")).toBeVisible();
    expect(
      picker.queryByRole("navigation", { name: "Folders above" }),
    ).toBeNull();
    expect(picker.queryByText("Choose a folder.")).toBeNull();
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
  });

  it("says why it cannot tell where the file sits, and tries again", async () => {
    const { drive } = openPlan();
    drive.getMetadata.mockImplementation((ref) =>
      ref.id === "work"
        ? Promise.reject(new DriveError(403, "Access denied."))
        : metadataOf(MY_ROOT, plan())(ref),
    );

    const picker = await openPicker();
    expect(await picker.findByRole("alert")).toHaveTextContent(
      "Access denied.",
    );
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
    drive.getMetadata.mockImplementation(metadataOf(MY_ROOT, WORK, plan()));
    fireEvent.click(picker.getByRole("button", { name: "Try again" }));
    expect(await picker.findByRole("heading", { name: "Work" })).toBeVisible();
  });

  it("offers no folder where the user cannot add files", async () => {
    const readOnly = folder("Read only", "read-only", "work");
    readOnly.capabilities.canAddChildren = false;
    const { drive } = openPlan();
    drive.getMetadata.mockImplementation(
      metadataOf(WORK, ARCHIVE, readOnly, plan()),
    );
    drive.listChildren.mockResolvedValue([readOnly]);

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Read only" }));
    expect(
      await picker.findByText("You cannot add files to this folder."),
    ).toBeVisible();
    expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
  });

  it("warns that links to a note in a vault will not follow", async () => {
    openPlan(plan(), [WORK]);

    const picker = await openPicker();
    expect(
      await picker.findByText(
        "This note is in an Obsidian vault. Links to it in other notes will not be updated: Obsidian updates them only when it moves a note itself.",
      ),
    ).toBeVisible();
  });

  it("says why Drive refused, and moves nothing when cancelled", async () => {
    const { drive } = openPlan();
    drive.moveFile.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );

    const picker = await openPicker();
    fireEvent.click(await picker.findByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(picker.getByRole("button", { name: "Move here" })).toBeEnabled();
    });
    fireEvent.click(picker.getByRole("button", { name: "Move here" }));
    expect(await picker.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
    fireEvent.click(picker.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
