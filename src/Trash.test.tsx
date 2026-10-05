import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FilePage } from "./FilePage.tsx";
import { getPlace, usePlace } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const WORK = metadata(folderItem("Work", { id: "work", parents: ["my-root"] }));
const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
  { name: "plan.md", href: "/edit?id=plan" },
];

function plan() {
  return metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }));
}

function PlanPage() {
  const { trail } = usePlace();
  return <FilePage file={{ id: "plan" }} trail={trail} />;
}

function openPlan(file: FileMetadata = plan()) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(WORK, file));
  drive.markViewed.mockResolvedValue();
  visit("/edit?id=plan", { trail: TRAIL });
  const rendered = renderWithDrive(<PlanPage />, drive);
  return { ...rendered, drive };
}

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
  return within(screen.getByRole("dialog", { name: "Move to trash?" }));
}

afterEach(() => {
  visit("/");
});

describe("Move to trash", () => {
  it("is offered only when Drive allows it", async () => {
    const file = plan();
    file.capabilities.canTrash = false;
    openPlan(file);

    await screen.findByText(/^Last modified/);
    expect(screen.queryByRole("button", { name: "Move to trash" })).toBeNull();
  });

  it("offers nothing on a file the user may not change", async () => {
    const file = plan();
    file.capabilities.canTrash = false;
    file.capabilities.canRename = false;
    file.capabilities.canMoveItemWithinDrive = false;
    file.capabilities.canMoveItemOutOfDrive = false;
    openPlan(file);

    await screen.findByText(/^Last modified/);
    for (const action of ["Rename", "Move", "Move to trash"]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });

  it("asks first, then trashes the file and goes back to its folder", async () => {
    const { drive, renew } = openPlan();
    drive.trashFile.mockResolvedValue();

    const dialog = await openDialog();
    expect(
      dialog.getByText(
        "plan.md goes to Google Drive's trash, from which it can be restored.",
      ),
    ).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Move to trash" }));
    expect(renew).toHaveBeenCalledOnce();
    await expect.poll(() => getPlace().href).toBe("/folder/work");
    expect(getPlace().trail).toEqual(TRAIL.slice(0, 2));
    expect(drive.trashFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan" }),
    );
  });

  it("marks what showed the file for Drive to answer again", async () => {
    const { drive, client } = openPlan();
    drive.trashFile.mockResolvedValue();
    client.setQueryData(["shortcut", "plan", undefined], null);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Move to trash" }));
    await expect.poll(() => getPlace().href).toBe("/folder/work");
    expect(
      client.getQueryState(["shortcut", "plan", undefined])?.isInvalidated,
    ).toBe(true);
  });

  it("goes to the file's folder while the path is still unknown", async () => {
    const drive = fakeDrive();
    const read = metadataOf(WORK, plan());
    drive.getMetadata.mockImplementation((ref) =>
      ref.id === "work"
        ? Promise.reject(new DriveError(503, "Backend error"))
        : read(ref),
    );
    drive.markViewed.mockResolvedValue();
    drive.trashFile.mockResolvedValue();
    visit("/edit?id=plan");
    renderWithDrive(<PlanPage />, drive);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Move to trash" }));
    await expect.poll(() => getPlace().href).toBe("/folder/work");
  });

  it("goes Home from a file in no folder, while its path is unknown", async () => {
    const drive = fakeDrive();
    const read = metadataOf(
      metadata(driveItem("plan.md", { id: "plan", parents: [] })),
    );
    drive.getMetadata.mockImplementation((ref) =>
      ref.id === "root"
        ? Promise.reject(new DriveError(503, "Backend error"))
        : read(ref),
    );
    drive.markViewed.mockResolvedValue();
    drive.trashFile.mockResolvedValue();
    visit("/edit?id=plan");
    renderWithDrive(<PlanPage />, drive);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Move to trash" }));
    await expect.poll(() => getPlace().href).toBe("/");
  });

  it("trashes nothing when cancelled", async () => {
    const { drive } = openPlan();

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(drive.trashFile).not.toHaveBeenCalled();
  });

  it("waits for Drive once asked, then says why it refused", async () => {
    const { drive } = openPlan();
    let refuse: (error: Error) => void = () => undefined;
    drive.trashFile.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Move to trash" }));
    await waitFor(() => {
      expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });
    refuse(
      new DriveError(403, "The user does not have sufficient permissions."),
    );
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
    expect(getPlace().href).toBe("/edit?id=plan");
  });
});
