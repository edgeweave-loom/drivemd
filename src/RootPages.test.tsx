import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getPlace } from "./router.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import {
  driveItem,
  FOLDER,
  folderItem,
  shortcutItem,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

function links() {
  return screen
    .getAllByRole("link")
    .filter((link) => !link.closest("nav"))
    .map((link) => link.textContent);
}

afterEach(() => {
  visit("/");
});

describe("ShortcutsPage", () => {
  it("lists the user's shortcuts to folders and Markdown files", async () => {
    const drive = fakeDrive();
    drive.listShortcuts.mockResolvedValue([
      shortcutItem("Notes", FOLDER),
      shortcutItem("plan.md", "text/markdown"),
      shortcutItem("Budget", "application/vnd.google-apps.spreadsheet"),
    ]);
    drive.checkShortcut.mockResolvedValue(undefined);
    renderWithDrive(<ShortcutsPage trail={undefined} />, drive);

    expect(screen.getByRole("heading", { name: "Shortcuts" })).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumbs" })).getByRole(
        "link",
        { name: "Home" },
      ),
    ).toHaveAttribute("href", "/");
    await screen.findByRole("link", { name: /Notes/ });
    expect(links()).toEqual(["NotesShortcut", "plan.mdShortcut"]);
    fireEvent.click(screen.getByRole("link", { name: /Notes/ }));
    expect(getPlace()).toMatchObject({
      href: "/folder/target-Notes?resourcekey=key",
      trail: [
        { name: "Shortcuts", href: "/shortcuts" },
        { name: "Notes", href: "/folder/target-Notes?resourcekey=key" },
      ],
    });
  });

  it("says when the user made no shortcut", async () => {
    const drive = fakeDrive();
    drive.listShortcuts.mockResolvedValue([]);
    renderWithDrive(<ShortcutsPage trail={undefined} />, drive);

    expect(
      await screen.findByText(
        "No shortcuts to folders or Markdown files. Make them in Google Drive.",
      ),
    ).toBeVisible();
  });
});

describe("SharedDrivesPage", () => {
  it("lists the shared drives in natural order, each opening its top folder", async () => {
    const drive = fakeDrive();
    drive.listSharedDrives.mockResolvedValue([
      { id: "drive-10", name: "Team 10" },
      { id: "drive-2", name: "team 2" },
    ]);
    visit("/shared-drives", {
      trail: [{ name: "Shared drives", href: "/shared-drives" }],
    });
    renderWithDrive(<SharedDrivesPage trail={getPlace().trail} />, drive);

    await screen.findByRole("link", { name: "team 2" });
    expect(links()).toEqual(["team 2", "Team 10"]);
    fireEvent.click(screen.getByRole("link", { name: "Team 10" }));
    expect(getPlace()).toMatchObject({
      href: "/folder/drive-10",
      trail: [
        { name: "Shared drives", href: "/shared-drives" },
        { name: "Team 10", href: "/folder/drive-10" },
      ],
    });
  });

  it("says when the user is in no shared drive", async () => {
    const drive = fakeDrive();
    drive.listSharedDrives.mockResolvedValue([]);
    renderWithDrive(<SharedDrivesPage trail={undefined} />, drive);

    expect(
      await screen.findByText("You are not a member of any shared drive."),
    ).toBeVisible();
  });
});

describe("SharedWithMePage", () => {
  it("lists the folders and Markdown files shared with the user", async () => {
    const drive = fakeDrive();
    drive.listSharedWithMe.mockResolvedValue([
      driveItem("minutes.md"),
      folderItem("Project"),
      driveItem("slides.pdf", { mimeType: "application/pdf" }),
    ]);
    renderWithDrive(<SharedWithMePage trail={undefined} />, drive);

    await screen.findByRole("link", { name: "Project" });
    expect(links()).toEqual(["Project", "minutes.md"]);
    fireEvent.click(screen.getByRole("link", { name: "Project" }));
    expect(getPlace().trail).toEqual([
      { name: "Shared with me", href: "/shared-with-me" },
      { name: "Project", href: "/folder/id-Project" },
    ]);
  });

  it("says when nothing is shared with the user", async () => {
    const drive = fakeDrive();
    drive.listSharedWithMe.mockResolvedValue([]);
    renderWithDrive(<SharedWithMePage trail={undefined} />, drive);

    expect(
      await screen.findByText(
        "No folders or Markdown files are shared with you.",
      ),
    ).toBeVisible();
  });
});
