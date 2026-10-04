import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NewPage } from "./NewPage.tsx";
import { getPlace, hrefOf } from "./router.ts";
import type { DriveItem } from "./drive.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const WORK = { id: "work", resourceKey: "k" };

const ROOT = folderItem("My Drive", { id: "my-root", parents: [] });

/**
 * Drive's New in the folder Work, after the page it was opened from; Drive
 * knows nothing of Work when `work` is null.
 */
function openNew(work: DriveItem | null = workFolder(true)) {
  const drive = fakeDrive();
  const items = work ? [work, ROOT] : [ROOT];
  drive.getMetadata.mockImplementation(
    metadataOf(...items.map((item) => metadata(item))),
  );
  visit("/");
  history.pushState(null, "", hrefOf({ name: "new", folder: WORK }));
  window.dispatchEvent(new PopStateEvent("popstate"));
  const entries = history.length;
  const rendered = renderWithDrive(<NewPage folder={WORK} />, drive);
  return { ...rendered, drive, entries };
}

function workFolder(canAddChildren: boolean) {
  const work = folderItem("Work", {
    id: "work",
    parents: ["my-root"],
    resourceKey: "k",
  });
  work.capabilities.canAddChildren = canAddChildren;
  return work;
}

async function nameDialog() {
  return within(
    await screen.findByRole("dialog", { name: "New Markdown file" }),
  );
}

afterEach(() => {
  visit("/");
});

describe("Drive's New", () => {
  it("asks for a name, creates the file in the folder, then opens it in its place", async () => {
    const { drive, renew, entries } = openNew();
    drive.createFile.mockResolvedValue(
      driveItem("Ideas.md", { id: "ideas", parents: ["work"] }),
    );

    const dialog = await nameDialog();
    expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Untitled",
    );
    fireEvent.change(dialog.getByRole("textbox", { name: "Name" }), {
      target: { value: "Ideas" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));
    expect(renew).toHaveBeenCalledOnce();
    await expect.poll(() => getPlace().href).toBe("/edit?id=ideas");
    expect(drive.createFile).toHaveBeenCalledWith(WORK, "Ideas");
    expect(history.length).toBe(entries);
    expect(getPlace().trail).toEqual([
      { name: "My Drive", href: "/my-drive" },
      { name: "Work", href: "/folder/work?resourcekey=k" },
      { name: "Ideas.md", href: "/edit?id=ideas" },
    ]);
  });

  it("opens the folder in its place when cancelled", async () => {
    const { drive, entries } = openNew();

    const dialog = await nameDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(getPlace().href).toBe("/folder/work?resourcekey=k");
    expect(history.length).toBe(entries);
    expect(drive.createFile).not.toHaveBeenCalled();
  });

  it("says when the user cannot add files to the folder", async () => {
    openNew(workFolder(false));

    expect(
      await screen.findByText("You cannot add files to this folder."),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open the folder" }),
    ).toHaveAttribute("href", "/folder/work?resourcekey=k");
  });

  it("says when the folder is not there", async () => {
    openNew(null);

    expect(
      await screen.findByText(
        "This folder does not exist, or it is not shared with you.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when Drive names something else than a folder", async () => {
    openNew(driveItem("plan.md", { id: "work", parents: ["my-root"] }));

    expect(await screen.findByText("This is not a folder.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the folder's path", async () => {
    openNew();

    await nameDialog();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(
      within(crumbs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "My Drive", "Work"]);
  });
});
