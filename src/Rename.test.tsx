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
import { moreActions } from "./test/actions.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const WORK = metadata(folderItem("Work", { id: "work", parents: ["my-root"] }));
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

function openPlan(file = plan(), vaults: FileMetadata[] = []) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(WORK, file));
  drive.markViewed.mockResolvedValue();
  drive.findVaultConfigs.mockResolvedValue(
    vaults.map(({ id }) =>
      folderItem(".obsidian", { id: `config-${id}`, parents: [id] }),
    ),
  );
  visit("/edit?id=plan", { trail: TRAIL });
  const rendered = renderWithDrive(<PlanPage />, drive);
  return { ...rendered, drive };
}

/** The file's page, with the path the history keeps, as the navigator shows it. */
function PlanPage() {
  const { trail } = usePlace();
  return <FilePage file={{ id: "plan" }} trail={trail} />;
}

async function openDialog() {
  fireEvent.click(
    (await moreActions()).getByRole("button", { name: "Rename" }),
  );
  return within(screen.getByRole("dialog", { name: "Rename" }));
}

function nameBox() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
}

afterEach(() => {
  visit("/");
});

describe("Rename", () => {
  it("is offered only when Drive allows it", async () => {
    const file = plan();
    file.capabilities.canRename = false;
    openPlan(file);

    const menu = await moreActions();
    expect(menu.getByRole("button", { name: "Move to trash" })).toBeVisible();
    expect(menu.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("renames the file, keeping the path taken", async () => {
    const { drive, renew } = openPlan();
    drive.renameFile.mockImplementation((file, name) =>
      Promise.resolve(driveItem(name, { id: file.id, parents: ["work"] })),
    );

    const dialog = await openDialog();
    expect(nameBox()).toHaveValue("plan.md");
    expect([nameBox().selectionStart, nameBox().selectionEnd]).toEqual([0, 4]);
    fireEvent.change(nameBox(), { target: { value: "roadmap.md" } });
    await waitFor(() => {
      expect(dialog.getByRole("button", { name: "Rename" })).toBeEnabled();
    });
    fireEvent.click(dialog.getByRole("button", { name: "Rename" }));
    expect(renew).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(drive.renameFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan" }),
      "roadmap.md",
    );
    expect(screen.getByRole("heading", { name: "roadmap.md" })).toBeVisible();
    expect(getPlace().trail).toEqual([
      ...TRAIL.slice(0, 2),
      { name: "roadmap.md", href: "/edit?id=plan" },
    ]);
  });

  it("takes the name as typed, without the phone's capitals or corrections", async () => {
    openPlan();

    await openDialog();
    expect(nameBox()).toHaveAttribute("autocapitalize", "none");
    expect(nameBox()).toHaveAttribute("autocorrect", "off");
    expect(nameBox()).toHaveAttribute("spellcheck", "false");
  });

  it("warns that links to a note in a vault will not follow", async () => {
    openPlan(plan(), [WORK]);

    const dialog = await openDialog();
    expect(
      await dialog.findByText(
        "This note is in an Obsidian vault. Links to it in other notes will not be updated: Obsidian updates them only when it renames a note itself.",
      ),
    ).toBeVisible();
  });

  it("waits for the vault check before renaming", async () => {
    const { drive } = openPlan();
    drive.findVaultConfigs.mockReturnValue(new Promise(() => undefined));

    const dialog = await openDialog();
    expect(
      dialog.getByText("Checking whether this note is in an Obsidian vault…"),
    ).toBeVisible();
    expect(dialog.getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("says when it could not check for a vault, and lets the user go on", async () => {
    const { drive } = openPlan();
    drive.findVaultConfigs.mockRejectedValue(
      new DriveError(400, "Bad request"),
    );

    const dialog = await openDialog();
    expect(
      await dialog.findByText(
        "DriveMD could not check whether this note is in an Obsidian vault. If it is, links to it in other notes will not be updated.",
      ),
    ).toBeVisible();
    expect(dialog.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("gives no such warning outside a vault", async () => {
    const { drive } = openPlan(plan(), [
      metadata(folderItem("Elsewhere", { id: "elsewhere" })),
    ]);

    const dialog = await openDialog();
    await expect.poll(() => drive.findVaultConfigs.mock.calls.length).toBe(1);
    await waitFor(() => {
      expect(drive.getMetadata).toHaveBeenCalledWith({ id: "root" });
    });
    expect(dialog.queryByText(/Obsidian vault/)).toBeNull();
  });

  it("warns when the name loses its Markdown ending", async () => {
    openPlan();

    const dialog = await openDialog();
    expect(dialog.queryByText(/DriveMD will no longer list/)).toBeNull();
    fireEvent.change(nameBox(), { target: { value: "plan.txt" } });
    expect(
      dialog.getByText(
        "Without .md or .markdown at the end, DriveMD will no longer list this file.",
      ),
    ).toBeVisible();
  });

  it("renames nothing when cancelled", async () => {
    const { drive } = openPlan();

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(drive.renameFile).not.toHaveBeenCalled();
  });

  it("says why Drive refused", async () => {
    const { drive } = openPlan();
    drive.renameFile.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );

    const dialog = await openDialog();
    await waitFor(() => {
      expect(dialog.getByRole("button", { name: "Rename" })).toBeEnabled();
    });
    fireEvent.click(dialog.getByRole("button", { name: "Rename" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
  });
});
