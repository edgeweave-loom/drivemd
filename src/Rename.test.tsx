import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveError, type DriveItem, type FileMetadata } from "./drive.ts";
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

function plan(changes: Partial<FileMetadata> = {}) {
  return metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }), {
    ...changes,
  });
}

function openPlan(file = plan(), vaults: FileMetadata[] = []) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(WORK, file));
  drive.markViewed.mockResolvedValue();
  drive.getContent.mockResolvedValue(new TextEncoder().encode("# The plan"));
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

/**
 * Starts renaming the note, as a click on its name does, once the note
 * shows, by when the page has asked where the vaults are.
 */
async function editName() {
  await screen.findByRole("heading", { name: "The plan" });
  fireEvent.click(screen.getByRole("button", { name: "plan.md" }));
  return nameField();
}

function nameField() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
}

function rename(name: string) {
  fireEvent.change(nameField(), { target: { value: name } });
  fireEvent.keyDown(nameField(), { key: "Enter" });
}

/** The dialog that asks first, once the vault check has answered. */
async function dialog() {
  return within(await screen.findByRole("dialog", { name: "Rename" }));
}

afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("Rename", () => {
  it("renames the file by its name, keeping its ending and the path taken", async () => {
    const { drive, renew } = openPlan();
    drive.renameFile.mockImplementation((file, name) =>
      Promise.resolve(driveItem(name, { id: file.id, parents: ["work"] })),
    );

    const field = await editName();
    expect(field).toHaveValue("plan");
    expect(field).toHaveFocus();
    expect(screen.getByText(".md")).toBeVisible();
    rename("roadmap");
    expect(renew).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(drive.renameFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan" }),
        "roadmap.md",
      );
    });
    const name = await screen.findByRole("button", { name: "roadmap.md" });
    expect(name).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getPlace().trail).toEqual([
      ...TRAIL.slice(0, 2),
      { name: "roadmap.md", href: "/edit?id=plan" },
    ]);
  });

  it("renames the file once the field is left", async () => {
    const { drive } = openPlan();
    drive.renameFile.mockImplementation((file, name) =>
      Promise.resolve(driveItem(name, { id: file.id, parents: ["work"] })),
    );

    const field = await editName();
    fireEvent.change(field, { target: { value: "roadmap" } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(drive.renameFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan" }),
        "roadmap.md",
      );
    });
  });

  it("leaves the name as it was on Escape", async () => {
    const { drive } = openPlan();

    const field = await editName();
    fireEvent.change(field, { target: { value: "roadmap" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("button", { name: "plan.md" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(drive.renameFile).not.toHaveBeenCalled();
  });

  it("renames nothing when the name stays the same or is left empty", async () => {
    const { drive } = openPlan();

    await editName();
    rename("plan");
    await editName();
    rename("  ");
    expect(
      await screen.findByRole("button", { name: "plan.md" }),
    ).toBeVisible();
    expect(drive.renameFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the name as typed, without the phone's capitals or corrections", async () => {
    openPlan();

    const field = await editName();
    expect(field).toHaveAttribute("autocapitalize", "none");
    expect(field).toHaveAttribute("autocorrect", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
  });

  it("is offered only when Drive allows it", async () => {
    const file = plan();
    file.capabilities.canRename = false;
    openPlan(file);

    await screen.findByText(/^Last modified/);
    expect(screen.getByRole("heading", { name: "plan.md" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "plan.md" })).toBeNull();
  });

  it("asks first in a vault, warning that links to the note will not follow", async () => {
    const { drive } = openPlan(plan(), [WORK]);
    drive.renameFile.mockImplementation((file, name) =>
      Promise.resolve(driveItem(name, { id: file.id, parents: ["work"] })),
    );

    await editName();
    rename("roadmap");
    const asked = await dialog();
    expect(
      await asked.findByText(
        "This note is in an Obsidian vault. Links to it in other notes will not be updated: Obsidian updates them only when it renames a note itself.",
      ),
    ).toBeVisible();
    expect(drive.renameFile).not.toHaveBeenCalled();
    expect(asked.getByRole("textbox", { name: "Name" })).toHaveValue(
      "roadmap.md",
    );
    fireEvent.click(asked.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(drive.renameFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan" }),
        "roadmap.md",
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("says when it could not check for a vault, and lets the user go on", async () => {
    const { drive } = openPlan();
    drive.findVaultConfigs.mockRejectedValue(
      new DriveError(400, "Bad request"),
    );

    await editName();
    rename("roadmap");
    const asked = await dialog();
    expect(
      await asked.findByText(
        "DriveMD could not check whether this note is in an Obsidian vault. If it is, links to it in other notes will not be updated.",
      ),
    ).toBeVisible();
    expect(asked.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("asks first while the vault check is still on its way, and waits for it", async () => {
    const { drive } = openPlan();
    let answer: (configs: DriveItem[]) => void = () => undefined;
    drive.findVaultConfigs.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    // The note waits for the check too, which its name does not.
    fireEvent.click(await screen.findByRole("button", { name: "plan.md" }));
    rename("roadmap");
    const asked = await dialog();
    expect(
      asked.getByText("Checking whether this note is in an Obsidian vault…"),
    ).toBeVisible();
    expect(asked.getByRole("button", { name: "Rename" })).toBeDisabled();
    answer([]);
    await waitFor(() => {
      expect(asked.getByRole("button", { name: "Rename" })).toBeEnabled();
    });
    expect(asked.queryByText(/Obsidian vault/)).toBeNull();
  });

  it("keeps a Markdown ending typed, and leaves out spaces around the name", async () => {
    const { drive } = openPlan();
    drive.renameFile.mockImplementation((file, name) =>
      Promise.resolve(driveItem(name, { id: file.id, parents: ["work"] })),
    );

    await editName();
    rename("  roadmap.markdown ");
    await waitFor(() => {
      expect(drive.renameFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan" }),
        "roadmap.markdown",
      );
    });
  });

  it("stays in the field while the window has lost the focus", async () => {
    const { drive } = openPlan();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const field = await editName();
    fireEvent.change(field, { target: { value: "road" } });
    fireEvent.blur(field);
    expect(nameField()).toHaveValue("road");
    expect(drive.renameFile).not.toHaveBeenCalled();
  });

  it("warns, once asked, when the name loses its Markdown ending", async () => {
    openPlan(plan(), [WORK]);

    await editName();
    rename("roadmap");
    const asked = await dialog();
    const name = asked.getByRole("textbox", { name: "Name" });
    expect(asked.queryByText(/DriveMD will no longer list/)).toBeNull();
    fireEvent.change(name, { target: { value: "roadmap.txt" } });
    expect(
      asked.getByText(
        "Without .md or .markdown at the end, DriveMD will no longer list this file.",
      ),
    ).toBeVisible();
  });

  it("renames nothing when the dialog is cancelled, and gives the name back", async () => {
    const { drive } = openPlan(plan(), [WORK]);

    await editName();
    rename("roadmap");
    fireEvent.click((await dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(drive.renameFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "plan.md" })).toHaveFocus();
  });

  it("says why Drive refused, keeping the name typed", async () => {
    const { drive } = openPlan();
    drive.renameFile.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );

    await editName();
    rename("roadmap");
    const asked = await dialog();
    expect(await asked.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
    expect(asked.getByRole("textbox", { name: "Name" })).toHaveValue(
      "roadmap.md",
    );
    expect(screen.getByRole("button", { name: "plan.md" })).toBeVisible();
  });
});
