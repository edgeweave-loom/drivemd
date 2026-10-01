import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveError, type DriveItem, type FileRef } from "./drive.ts";
import { Rendered } from "./Markdown.tsx";
import { getPlace } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const NOTES = folderItem("notes", { id: "notes", parents: ["work"] });
const FOLDERS: Record<string, DriveItem[]> = {
  notes: [
    driveItem("plan.md", { id: "plan", parents: ["notes"] }),
    driveItem("data.csv", {
      id: "data",
      mimeType: "text/csv",
      parents: ["notes"],
    }),
    driveItem("My note.md", { id: "mine", parents: ["notes"] }),
  ],
  work: [NOTES],
};

function open(text: string, folder: FileRef | undefined = { id: "notes" }) {
  const drive = fakeDrive();
  drive.listChildren.mockImplementation((ref) => {
    const items = FOLDERS[ref.id];
    return items
      ? Promise.resolve(items)
      : Promise.reject(new DriveError(404, "File not found"));
  });
  drive.getMetadata.mockImplementation(metadataOf(metadata(NOTES)));
  return renderWithDrive(<Rendered text={text} folder={folder} />, drive);
}

afterEach(() => {
  visit("/");
});

describe("relative links in a note", () => {
  it("open a Markdown file in the app, from the note's folder", async () => {
    const { drive, renew } = open(
      "[Plan](plan.md) and [Mine](My%20note.md#tea)",
    );

    const plan = await screen.findByRole("link", { name: "Plan" });
    expect(plan).toHaveAttribute("href", "/edit?id=plan");
    expect(await screen.findByRole("link", { name: "Mine" })).toHaveAttribute(
      "href",
      "/edit?id=mine",
    );
    fireEvent.click(plan);
    expect(renew).toHaveBeenCalledOnce();
    expect(getPlace().route).toEqual({ name: "file", file: { id: "plan" } });
    // Both links share the folder's listing.
    expect(drive.listChildren).toHaveBeenCalledOnce();
  });

  it("open a folder in the app, climbing to the folder above", async () => {
    open("[Up](../) [Notes](../notes/)");

    expect(await screen.findByRole("link", { name: "Up" })).toHaveAttribute(
      "href",
      "/folder/work",
    );
    expect(await screen.findByRole("link", { name: "Notes" })).toHaveAttribute(
      "href",
      "/folder/notes",
    );
  });

  it("keep their title and their id", async () => {
    open('[Plan](plan.md "The plan") <a id="top" href="plan.md">Top</a>');

    const plan = await screen.findByRole("link", { name: "Plan" });
    expect(plan).toHaveAttribute("title", "The plan");
    expect(await screen.findByRole("link", { name: "Top" })).toHaveAttribute(
      "id",
      "user-content-top",
    );
  });

  it("stay as they are when Drive cannot say where they lead", async () => {
    // Drive refuses to list the note's folder.
    open("[Plan](plan.md)", { id: "elsewhere" });

    await waitFor(() => {
      expect(screen.getByText("Plan")).toHaveAttribute(
        "title",
        "Google Drive could not say where this link leads",
      );
    });
    expect(screen.getByText("Plan")).not.toHaveClass("unresolved");
  });

  it("open another file in Google Drive, in a new tab", async () => {
    open("[Data](data.csv)");

    const data = await screen.findByRole("link", { name: "Data" });
    expect(data).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/data/view",
    );
    expect(data).toHaveAttribute("target", "_blank");
    expect(data).toHaveAttribute("rel", "noreferrer");
  });

  it.each([
    ["nothing at its path", "[Gone](gone.md)", { id: "notes" }],
    ["a file taken for a folder", "[Gone](plan.md/x.md)", { id: "notes" }],
  ])("show faded when they lead to %s", async (_, text, folder) => {
    open(text, folder);

    await waitFor(() => {
      expect(screen.getByText("Gone")).toHaveClass("unresolved");
    });
    expect(screen.getByText("Gone")).toHaveAttribute(
      "title",
      "Not found in Google Drive",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("show faded, without asking Drive, in a note whose folder is unknown", () => {
    const { drive } = renderWithDrive(<Rendered text="[Plan](plan.md)" />);

    expect(screen.getByText("Plan")).toHaveClass("unresolved");
    expect(drive.listChildren).not.toHaveBeenCalled();
  });
});
