import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FilePage } from "./FilePage.tsx";
import { getPlace, type Crumb } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
  shortcutItem,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const WORK = metadata(folderItem("Work", { id: "work", parents: ["my-root"] }));
const PLAN = metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }));
const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
  { name: "plan.md", href: "/edit?id=plan" },
];

function openFile(trail: Crumb[] | undefined, ...items: FileMetadata[]) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(WORK, ...items));
  drive.markViewed.mockResolvedValue();
  drive.listChildren.mockResolvedValue([]);
  drive.getContent.mockResolvedValue(new TextEncoder().encode("# The plan"));
  const rendered = renderWithDrive(
    <FilePage file={{ id: "plan" }} trail={trail} />,
    drive,
  );
  return { ...rendered, drive };
}

function crumbs() {
  return within(screen.getByRole("navigation", { name: "Breadcrumbs" }));
}

afterEach(() => {
  visit("/");
});

describe("FilePage", () => {
  it("names the file, says who changed it last, shows it, and marks it viewed", async () => {
    const { drive } = openFile(TRAIL, PLAN);

    expect(screen.getByRole("heading", { name: "plan.md" })).toBeVisible();
    expect(crumbs().getByRole("link", { name: "Work" })).toBeVisible();
    expect(
      await screen.findByText(/^Last modified by Ada Lovelace on .*2026/),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "The plan" }),
    ).toBeVisible();
    expect(drive.markViewed).toHaveBeenCalledExactlyOnceWith({ id: "plan" });
  });

  it("rebuilds the breadcrumbs from Drive when the path is unknown", async () => {
    openFile(undefined, PLAN);

    expect(
      await screen.findByRole("heading", { name: "plan.md" }),
    ).toBeVisible();
    expect(await crumbs().findByRole("link", { name: "Work" })).toHaveAttribute(
      "href",
      "/folder/work",
    );
  });

  it("leaves out who changed it when Drive does not say", async () => {
    openFile(
      TRAIL,
      metadata(driveItem("plan.md", { id: "plan" }), {
        lastModifiedBy: undefined,
      }),
    );

    expect(await screen.findByText(/^Last modified on /)).toBeVisible();
  });

  it("says nothing of a change Drive does not date", async () => {
    openFile(TRAIL, metadata(PLAN, { modifiedTime: undefined }));

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });
    expect(screen.queryByText(/^Last modified/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens even when marking it viewed fails", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockImplementation(metadataOf(WORK, PLAN));
    drive.markViewed.mockRejectedValue(new DriveError(403, "Forbidden"));
    drive.listChildren.mockResolvedValue([]);
    drive.getContent.mockResolvedValue(new TextEncoder().encode("# The plan"));
    renderWithDrive(<FilePage file={{ id: "plan" }} trail={TRAIL} />, drive);

    expect(
      await screen.findByRole("heading", { name: "The plan" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the file is out of reach", async () => {
    openFile(TRAIL);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file does not exist, or it is not shared with you.",
    );
  });

  it("leads to a folder whose address it was given, keeping the path", async () => {
    const { drive } = openFile(
      [
        { name: "My Drive", href: "/my-drive" },
        { name: "plan", href: "/edit?id=plan" },
      ],
      metadata(folderItem("plan", { id: "plan", parents: ["my-root"] })),
    );

    fireEvent.click(
      await screen.findByRole("link", { name: "Open the folder" }),
    );
    expect(getPlace()).toMatchObject({
      href: "/folder/plan",
      trail: [
        { name: "My Drive", href: "/my-drive" },
        { name: "plan", href: "/folder/plan" },
      ],
    });
    expect(drive.markViewed).not.toHaveBeenCalled();
  });

  it("leads to what a shortcut points to", async () => {
    const { drive } = openFile(TRAIL, {
      ...metadata(shortcutItem("plan.md", "text/markdown")),
      id: "plan",
    });

    expect(
      await screen.findByRole("link", { name: "Open what it points to" }),
    ).toHaveAttribute("href", "/edit?id=target-plan.md&resourcekey=key");
    expect(drive.markViewed).not.toHaveBeenCalled();
  });

  it("says a file in the trash is there, and leaves it unmarked", async () => {
    const { drive } = openFile(TRAIL, metadata(PLAN, { trashed: true }));

    expect(
      await screen.findByText(
        "This file is in the trash. Restore it from Google Drive to open it.",
      ),
    ).toBeVisible();
    expect(drive.markViewed).not.toHaveBeenCalled();
  });

  it("marks the file viewed once, however often its page draws", async () => {
    const { drive, rerender } = openFile(TRAIL, PLAN);
    await screen.findByText(/^Last modified/);

    rerender(<FilePage file={{ id: "plan" }} trail={TRAIL} />);
    expect(drive.markViewed).toHaveBeenCalledOnce();
  });

  it("has Home ask Drive for Recent again once the file is marked viewed", async () => {
    const { drive, client } = openFile(TRAIL, PLAN);
    client.setQueryData(["recent"], []);

    await expect
      .poll(() => drive.markViewed.mock.results[0]?.type)
      .toBe("return");
    await expect
      .poll(() => client.getQueryState(["recent"])?.isInvalidated)
      .toBe(true);
  });

  it("names a file it could not read as a file", async () => {
    openFile(undefined);

    expect(await screen.findByRole("heading", { name: "File" })).toBeVisible();
  });

  it("says nothing of a change dated oddly", async () => {
    openFile(TRAIL, metadata(PLAN, { modifiedTime: "yesterday" }));

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });
    expect(screen.queryByText(/^Last modified/)).toBeNull();
  });

  it.each([
    driveItem("plan.md", {
      id: "plan",
      mimeType: "application/vnd.google-apps.document",
    }),
    driveItem("plan.pdf", { id: "plan", mimeType: "application/pdf" }),
  ])("opens nothing but Markdown files: %s", async (item) => {
    const { drive } = openFile(TRAIL, metadata(item));

    expect(
      await screen.findByText("DriveMD opens Markdown files only."),
    ).toBeVisible();
    expect(drive.markViewed).not.toHaveBeenCalled();
  });
});
