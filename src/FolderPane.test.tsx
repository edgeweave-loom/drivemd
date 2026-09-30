import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DriveItem, FileMetadata } from "./drive.ts";
import { FileView } from "./FilePage.tsx";
import { getPlace, usePlace, type Crumb } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
  shortcutItem,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const WORK = metadata(folderItem("Work", { id: "work", parents: ["my-root"] }));
const PLAN = metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }));
const NOTES = metadata(
  driveItem("notes.md", { id: "notes", parents: ["work"] }),
);
const TRAIL = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
  { name: "plan.md", href: "/edit?id=plan" },
];

/** The file the address names, as the navigator shows it. */
function Page() {
  const { route, trail } = usePlace();
  return route.name === "file" ? (
    <FileView file={route.file} trail={trail} />
  ) : null;
}

function openPlan(
  trail: Crumb[] | undefined,
  file: FileMetadata = PLAN,
  listed: DriveItem[] = [PLAN, NOTES],
) {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(metadataOf(WORK, file, NOTES));
  drive.markViewed.mockResolvedValue();
  drive.listChildren.mockResolvedValue(listed);
  visit("/edit?id=plan", { trail });
  renderWithDrive(<Page />, drive);
  return drive;
}

function pane() {
  return within(screen.getByRole("complementary", { name: "Work" }));
}

afterEach(() => {
  visit("/");
});

describe("the folder pane", () => {
  it("lists the file's folder beside it on a wide screen, marking the file", async () => {
    holdScreen("wide");
    const drive = openPlan(TRAIL);

    await screen.findByRole("complementary", { name: "Work" });
    expect(await pane().findByRole("link", { name: "notes.md" })).toBeVisible();
    expect(pane().getByRole("link", { name: "plan.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(drive.listChildren).toHaveBeenCalledWith({ id: "work" });
    fireEvent.click(pane().getByRole("link", { name: "notes.md" }));
    expect(getPlace().trail).toEqual([
      ...TRAIL.slice(0, 2),
      { name: "notes.md", href: "/edit?id=notes" },
    ]);
    expect(
      await screen.findByRole("heading", { level: 2, name: "notes.md" }),
    ).toBeVisible();
    expect(pane().getByRole("link", { name: "notes.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps its place while another file of the folder opens", async () => {
    holdScreen("wide");
    openPlan(TRAIL);
    const aside = await screen.findByRole("complementary", { name: "Work" });
    await pane().findByRole("link", { name: "notes.md" });

    fireEvent.click(pane().getByRole("link", { name: "notes.md" }));
    expect(screen.getByRole("complementary", { name: "Work" })).toBe(aside);
  });

  it("marks the file when a shortcut in the folder leads to it", async () => {
    holdScreen("wide");
    const linked = shortcutItem("Linked plan.md", "text/markdown");
    linked.target = {
      id: "plan",
      mimeType: "text/markdown",
      resourceKey: undefined,
    };
    openPlan(TRAIL, PLAN, [linked, NOTES]);

    await screen.findByRole("complementary", { name: "Work" });
    expect(
      await pane().findByRole("link", { name: /Linked plan\.md/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("finds the folder from Drive when the path is unknown", async () => {
    holdScreen("wide");
    openPlan(undefined);

    await screen.findByRole("complementary", { name: "Work" });
    expect(await pane().findByRole("link", { name: "notes.md" })).toBeVisible();
    expect(pane().getByRole("link", { name: "Work" })).toHaveAttribute(
      "href",
      "/folder/work",
    );
  });

  it("folds into a drawer on a tablet, which closes with a tap", async () => {
    holdScreen("tablet");
    openPlan(TRAIL);

    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Folder" }));
    const drawer = within(screen.getByRole("dialog", { name: "Work" }));
    expect(await drawer.findByRole("link", { name: "notes.md" })).toBeVisible();
    fireEvent.click(drawer.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the drawer for the pane when the tablet turns", async () => {
    holdScreen("tablet");
    openPlan(TRAIL);
    fireEvent.click(await screen.findByRole("button", { name: "Folder" }));

    act(() => {
      holdScreen("wide");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      await screen.findByRole("complementary", { name: "Work" }),
    ).toBeVisible();
  });

  it.each([
    [[{ name: "plan.md", href: "/edit?id=plan" }]],
    [
      [
        { name: "Shared with me", href: "/shared-with-me" },
        { name: "plan.md", href: "/edit?id=plan" },
      ],
    ],
  ])("lists no folder where the path shows none: %j", async (trail) => {
    holdScreen("wide");
    const drive = openPlan(trail);

    await screen.findByText(/^Last modified/);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("waits for the path before listing the folder", async () => {
    holdScreen("wide");
    const drive = openPlan(undefined);
    const read = metadataOf(WORK, PLAN);
    drive.getMetadata.mockImplementation((ref) =>
      ref.id === "work" ? new Promise(() => undefined) : read(ref),
    );

    await screen.findByText(/^Last modified/);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("shows nothing of the folder on a phone, nor asks Drive for it", async () => {
    const drive = openPlan(TRAIL);

    await screen.findByText(/^Last modified/);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Folder" })).toBeNull();
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it("shows no folder beside a file the page cannot open", async () => {
    holdScreen("wide");
    const drive = openPlan(TRAIL, metadata(PLAN, { trashed: true }));

    await screen.findByText(/in the trash/);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(drive.listChildren).not.toHaveBeenCalled();
  });
});
