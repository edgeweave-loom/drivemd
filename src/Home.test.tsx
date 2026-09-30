import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { Home } from "./Home.tsx";
import { driveItem, folderItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

function linksIn(name: string) {
  return section(name)
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("Home", () => {
  it("shows the files opened last, newest first, then vaults and roots", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockResolvedValue([
      driveItem("zeta.md"),
      driveItem("alpha.md"),
    ]);
    drive.findVaults.mockResolvedValue([
      metadata(folderItem("Work notes")),
      metadata(folderItem("Journal")),
    ]);
    renderWithDrive(<Home />, drive);

    expect(
      await section("Recent").findByRole("link", { name: "zeta.md" }),
    ).toBeVisible();
    expect(linksIn("Recent")).toEqual(["zeta.md", "alpha.md"]);
    await section("Vaults").findByRole("link", { name: "Journal" });
    expect(linksIn("Vaults")).toEqual(["Journal", "Work notes"]);
    expect(linksIn("Browse")).toEqual([
      "My Drive",
      "Shortcuts",
      "Shared drives",
      "Shared with me",
    ]);
  });

  it("says what fills Recent and Vaults when they are empty", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockResolvedValue([]);
    drive.findVaults.mockResolvedValue([]);
    renderWithDrive(<Home />, drive);

    expect(
      await section("Recent").findByText(
        "The Markdown files you view, here or in Google Drive, show here.",
      ),
    ).toBeVisible();
    expect(
      await section("Vaults").findByText(
        "No Obsidian vault in your Drive: a vault is a folder with a .obsidian folder in it.",
      ),
    ).toBeVisible();
  });

  it.each([
    ["Recent", "Vaults"],
    ["Vaults", "Recent"],
  ])("keeps %s's failure out of %s", async (failing, working) => {
    const drive = fakeDrive();
    const lists = { Recent: drive.listRecent, Vaults: drive.findVaults };
    lists[failing as keyof typeof lists].mockRejectedValue(
      new DriveError(503, "Backend error"),
    );
    lists[working as keyof typeof lists].mockResolvedValue([
      metadata(folderItem("Journal")),
    ]);
    renderWithDrive(<Home />, drive);

    expect(await section(failing).findByRole("alert")).toHaveTextContent(
      "Backend error",
    );
    expect(
      await section(working).findByRole("link", { name: "Journal" }),
    ).toBeVisible();
  });

  it("keeps each section apart when Drive fails for one", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockRejectedValue(new DriveError(503, "Backend error"));
    drive.findVaults.mockResolvedValue([metadata(folderItem("Journal"))]);
    renderWithDrive(<Home />, drive);

    expect(await section("Recent").findByRole("alert")).toHaveTextContent(
      "Backend error",
    );
    expect(
      await section("Vaults").findByRole("link", { name: "Journal" }),
    ).toBeVisible();
  });
});
