import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "./auth.ts";
import { DriveError } from "./drive.ts";
import { FolderPage } from "./FolderPage.tsx";
import { getPlace } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
];

function openWork(canAddChildren: boolean) {
  const work = folderItem("Work", { id: "work", parents: ["my-root"] });
  work.capabilities.canAddChildren = canAddChildren;
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(metadata(work)));
  drive.listChildren.mockResolvedValue([]);
  visit("/folder/work", { trail: TRAIL });
  const rendered = renderWithDrive(
    <FolderPage folder={{ id: "work" }} trail={TRAIL} />,
    drive,
  );
  return { ...rendered, drive };
}

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "New" }));
  return within(screen.getByRole("dialog", { name: "New Markdown file" }));
}

afterEach(() => {
  visit("/");
});

describe("New", () => {
  it("is offered only where the user can add files", async () => {
    openWork(false);

    await screen.findByText("No folders or Markdown files here.");
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });

  it("asks for a name, creates the file, then opens it", async () => {
    const { drive, renew } = openWork(true);
    drive.createFile.mockResolvedValue(
      driveItem("Ideas.md", { id: "ideas", parents: ["work"] }),
    );

    const dialog = await openDialog();
    const name = dialog.getByRole<HTMLInputElement>("textbox", {
      name: "Name",
    });
    expect(name).toHaveValue("Untitled");
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 8]);
    name.setSelectionRange(3, 3);
    fireEvent.focus(name);
    expect([name.selectionStart, name.selectionEnd]).toEqual([3, 3]);
    fireEvent.change(name, { target: { value: " Ideas " } });
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));
    expect(renew).toHaveBeenCalledOnce();
    await expect.poll(() => getPlace().href).toBe("/edit?id=ideas");
    expect(drive.createFile).toHaveBeenCalledWith({ id: "work" }, " Ideas ");
    expect(getPlace().trail).toEqual([
      ...TRAIL,
      { name: "Ideas.md", href: "/edit?id=ideas" },
    ]);
  });

  it("refuses a blank name", async () => {
    openWork(true);

    const dialog = await openDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Name" }), {
      target: { value: "  " },
    });
    expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("says why Drive refused, and keeps the name typed", async () => {
    const { drive } = openWork(true);
    drive.createFile.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );

    const dialog = await openDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Name" }), {
      target: { value: "Ideas" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Google Drive refused the request: The user does not have sufficient permissions.",
    );
    expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Ideas");
    expect(getPlace().href).toBe("/folder/work");
  });

  it("waits for Drive once asked, since the file is made either way", async () => {
    const { drive } = openWork(true);
    drive.createFile.mockReturnValue(new Promise(() => undefined));

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });
    expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    const modal = screen.getByRole("dialog");
    expect(fireEvent(modal, new Event("cancel", { cancelable: true }))).toBe(
      false,
    );
  });

  it("says a sign-in that did not finish did nothing", async () => {
    const { drive } = openWork(true);
    drive.createFile.mockRejectedValue(
      new AuthError("popup_blocked", "The browser blocked the window"),
    );

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Create" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Google sign-in did not finish, so nothing was done. Try again.",
    );
  });

  it("creates nothing when cancelled", async () => {
    const { drive } = openWork(true);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(drive.createFile).not.toHaveBeenCalled();
  });
});
