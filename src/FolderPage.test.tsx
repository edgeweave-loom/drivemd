import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { FolderPage } from "./FolderPage.tsx";
import { getPlace } from "./router.ts";
import {
  driveItem,
  FOLDER,
  folderItem,
  metadata,
  metadataOf,
  shortcutItem,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const WORK = folderItem("Work", { id: "work", parents: ["my-root"] });
const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
];

function openWork(children: Promise<unknown>, trail = TRAIL) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(metadata(WORK)));
  drive.listChildren.mockReturnValue(children as never);
  visit("/folder/work", { trail });
  return renderWithDrive(
    <FolderPage folder={{ id: "work" }} trail={getPlace().trail} />,
    drive,
  );
}

/** The folder's entries, apart from the breadcrumbs. */
function listed() {
  const [list] = screen
    .getAllByRole("list")
    .filter((found) => !found.closest("nav"));
  if (!list) throw new Error("No list of entries");
  return within(list);
}

function links() {
  return listed()
    .getAllByRole("link")
    .map((link) => link.textContent);
}

afterEach(() => {
  visit("/");
});

describe("FolderPage", () => {
  it("lists folders, then Markdown files, under the name the path gave", async () => {
    openWork(
      Promise.resolve([
        driveItem("b.md"),
        folderItem("Notes"),
        driveItem("a.md"),
        driveItem("photo.png", { mimeType: "image/png" }),
        folderItem(".obsidian"),
      ]),
      [
        ...TRAIL.slice(0, 1),
        { name: "Work (via shortcut)", href: "/folder/work" },
      ],
    );

    expect(
      screen.getByRole("heading", { name: "Work (via shortcut)" }),
    ).toBeInTheDocument();
    await screen.findByRole("link", { name: "a.md" });
    expect(links()).toEqual(["Notes", "a.md", "b.md"]);
  });

  it("rebuilds the path from Drive when it is unknown, and carries it on", async () => {
    const { drive } = openWork(Promise.resolve([folderItem("Notes")]), []);

    expect(await screen.findByRole("heading", { name: "Work" })).toBeVisible();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(
      await within(crumbs).findByRole("link", { name: "My Drive" }),
    ).toBeVisible();
    expect(drive.listChildren).toHaveBeenCalledWith({ id: "work" });
    fireEvent.click(screen.getByRole("link", { name: "Notes" }));
    expect(getPlace().trail).toEqual([
      { name: "My Drive", href: "/my-drive" },
      { name: "Work", href: "/folder/work" },
      { name: "Notes", href: "/folder/id-Notes" },
    ]);
  });

  it("calls it a folder when Drive cannot name it", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockRejectedValue(new DriveError(500, "Backend error"));
    drive.listChildren.mockResolvedValue([]);
    visit("/folder/work");
    renderWithDrive(
      <FolderPage folder={{ id: "work" }} trail={undefined} />,
      drive,
    );

    expect(
      await screen.findByRole("heading", { name: "Folder" }),
    ).toBeVisible();
  });

  it("says when the address names something other than a folder", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockImplementation(
      metadataOf(metadata(driveItem("notes.md", { parents: ["my-root"] }))),
    );
    drive.listChildren.mockResolvedValue([]);
    visit("/folder/id-notes_md");
    renderWithDrive(
      <FolderPage folder={{ id: "id-notes_md" }} trail={undefined} />,
      drive,
    );

    expect(await screen.findByText("This is not a folder.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "notes.md" })).toBeVisible();
    expect(screen.queryByText(/No folders/)).toBeNull();
  });

  it("keeps the list when refreshing it fails, and says so", async () => {
    const { drive, client } = openWork(Promise.resolve([driveItem("a.md")]));
    expect(await screen.findByRole("link", { name: "a.md" })).toBeVisible();

    drive.listChildren.mockRejectedValue(new DriveError(503, "Backend error"));
    await act(() => client.invalidateQueries());
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend error");
    expect(screen.getByRole("link", { name: "a.md" })).toBeVisible();
  });

  it("shows that it is trying again", async () => {
    const { drive, client } = openWork(Promise.resolve([driveItem("a.md")]));
    await screen.findByRole("link", { name: "a.md" });
    drive.listChildren.mockRejectedValue(new DriveError(503, "Backend error"));
    await act(() => client.invalidateQueries());
    await screen.findByRole("alert");

    drive.listChildren.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Trying again…")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "a.md" })).toBeVisible();
  });

  it("opens a folder or file, keeping the path taken", async () => {
    openWork(Promise.resolve([folderItem("Notes"), driveItem("a.md")]));

    fireEvent.click(await screen.findByRole("link", { name: "Notes" }));
    expect(getPlace()).toEqual({
      route: { name: "folder", folder: { id: "id-Notes" } },
      href: "/folder/id-Notes",
      trail: [...TRAIL, { name: "Notes", href: "/folder/id-Notes" }],
    });
    fireEvent.click(screen.getByRole("link", { name: "a.md" }));
    expect(getPlace().href).toBe("/edit?id=id-a_md");
  });

  it("follows a shortcut to its target, and marks it", async () => {
    openWork(Promise.resolve([shortcutItem("Linked", FOLDER)]));

    const link = await screen.findByRole("link", { name: /Linked/ });
    expect(link).toHaveTextContent("Shortcut");
    fireEvent.click(link);
    expect(getPlace().route).toEqual({
      name: "folder",
      folder: { id: "target-Linked", resourceKey: "key" },
    });
  });

  it("says when the folder holds nothing to show", async () => {
    openWork(Promise.resolve([driveItem("photo.png")]));

    expect(
      await screen.findByText("No folders or Markdown files here."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      new DriveError(404, "File not found: work."),
      "This folder does not exist, or it is not shared with you.",
    ],
    [
      new DriveError(0, "Google Drive could not be reached"),
      "Google Drive could not be reached. Check your connection.",
    ],
    [
      new DriveError(403, "The user does not have sufficient permissions."),
      "Google Drive refused the request: The user does not have sufficient permissions.",
    ],
    [new Error("boom"), "Something went wrong."],
  ])("explains %s, then tries again after renewing", async (error, message) => {
    const { drive, renew } = openWork(Promise.reject(error));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    drive.listChildren.mockResolvedValue([driveItem("a.md")]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(renew).toHaveBeenCalledOnce();
    expect(await screen.findByRole("link", { name: "a.md" })).toBeVisible();
  });
});
