// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DriveError, type DriveItem, type FileRef } from "./drive.ts";
import { relativePath, resolve } from "./resolve.ts";
import { driveItem, folderItem, shortcutItem } from "./test/drive-items.ts";

describe("relativePath", () => {
  it.each([
    ["other.md", ["other.md"]],
    ["./notes/plan.md", [".", "notes", "plan.md"]],
    ["../img/a.png", ["..", "img", "a.png"]],
    ["My%20note.md", ["My note.md"]],
    ["caf%C3%A9.md#tea", ["café.md"]],
    ["plan.md?raw=1", ["plan.md"]],
    ["notes/", ["notes", ""]],
  ])("reads the steps of %j", (href, steps) => {
    expect(relativePath(href)).toEqual(steps);
  });

  it.each([
    [""],
    ["#heading"],
    ["?q=tea"],
    ["/abs/plan.md"],
    ["//example.com/plan.md"],
    ["https://example.com/plan.md"],
    ["mailto:ada@example.com"],
    ["C:plan.md"],
    ["%E0.md"],
  ])("leaves out what is not a relative path: %j", (href) => {
    expect(relativePath(href)).toBeUndefined();
  });
});

describe("resolve", () => {
  const NOTES = folderItem("notes", { id: "notes", parents: ["work"] });
  const PLAN = driveItem("plan.md", { id: "plan", parents: ["notes"] });
  const IMG = folderItem("img", { id: "img", parents: ["notes"] });
  const PHOTO = driveItem("a.png", {
    id: "photo",
    mimeType: "image/png",
    parents: ["img"],
  });
  const WORK_ITEMS: Record<string, DriveItem[]> = {
    work: [NOTES, driveItem("todo.md", { id: "todo", parents: ["work"] })],
    notes: [
      PLAN,
      IMG,
      { ...shortcutItem("To todo.md", "text/markdown"), id: "to-todo" },
    ],
    img: [PHOTO],
  };
  const PARENTS: Record<string, string | undefined> = {
    notes: "work",
    img: "notes",
    work: undefined,
  };

  function reader() {
    return {
      children: vi.fn((folder: FileRef) => {
        const items = WORK_ITEMS[folder.id];
        return items
          ? Promise.resolve(items)
          : Promise.reject(new DriveError(404, "File not found"));
      }),
      parent: vi.fn((folder: FileRef) => Promise.resolve(PARENTS[folder.id])),
    };
  }

  it("finds a file in the note's folder", async () => {
    await expect(
      resolve({ id: "notes" }, ["plan.md"], reader()),
    ).resolves.toEqual({
      ref: { id: "plan", resourceKey: undefined },
      name: "plan.md",
      mimeType: "text/markdown",
    });
  });

  it("goes down folders and up to parents, skipping . and empty steps", async () => {
    const read = reader();

    await expect(
      resolve({ id: "img" }, ["..", ".", "", "img", "a.png"], read),
    ).resolves.toMatchObject({ ref: { id: "photo" }, mimeType: "image/png" });
    await expect(
      resolve({ id: "notes" }, ["..", "todo.md"], read),
    ).resolves.toMatchObject({ ref: { id: "todo" } });
    expect(read.parent).toHaveBeenCalledWith({ id: "img" });
  });

  it("leads to the folder itself for an empty path or a folder's name", async () => {
    await expect(resolve({ id: "notes" }, ["", ""], reader())).resolves.toEqual(
      {
        ref: { id: "notes" },
        name: "",
        mimeType: "application/vnd.google-apps.folder",
      },
    );
    await expect(
      resolve({ id: "notes" }, ["img", ""], reader()),
    ).resolves.toMatchObject({ ref: { id: "img" }, name: "img" });
  });

  it("follows a shortcut to its target, keeping the shortcut's name", async () => {
    await expect(
      resolve({ id: "notes" }, ["To todo.md"], reader()),
    ).resolves.toEqual({
      ref: { id: "target-To todo.md", resourceKey: "key" },
      name: "To todo.md",
      mimeType: "text/markdown",
    });
  });

  it.each([
    ["a name nothing has", ["missing.md"]],
    ["a name that differs in case", ["PLAN.md"]],
    ["a file taken for a folder", ["plan.md", "x.md"]],
    ["a parent above the top", ["..", "..", "plan.md"]],
  ])("finds nothing for %s", async (_, path) => {
    await expect(
      resolve({ id: "notes" }, path, reader()),
    ).resolves.toBeUndefined();
  });

  it("fails as Drive does for a folder it cannot list", async () => {
    await expect(
      resolve({ id: "elsewhere" }, ["plan.md"], reader()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
