import { describe, expect, it, vi } from "vitest";
import { DriveError, type FileMetadata, type FileRef } from "./drive.ts";
import { pathTo } from "./path.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";

/** Reads made-up metadata by ID; an unknown ID is not found. */
function reader(...items: FileMetadata[]) {
  return vi.fn(metadataOf(...items));
}

describe("pathTo", () => {
  it("climbs to My Drive", async () => {
    const read = reader(
      metadata(folderItem("Work", { id: "work", parents: ["my-root"] })),
      metadata(driveItem("plan.md", { id: "plan", parents: ["work"] })),
    );

    await expect(pathTo({ id: "plan" }, read)).resolves.toEqual([
      { name: "My Drive", href: "/my-drive" },
      { name: "Work", href: "/folder/work" },
      { name: "plan.md", href: "/edit?id=plan" },
    ]);
  });

  it("names My Drive itself as the root", async () => {
    await expect(pathTo({ id: "root" }, reader())).resolves.toEqual([
      { name: "My Drive", href: "/my-drive" },
    ]);
  });

  it("climbs to a shared drive", async () => {
    const read = reader(
      metadata(
        folderItem("Team", { id: "drive-1", driveId: "drive-1", parents: [] }),
      ),
      metadata(
        folderItem("Specs", {
          id: "specs",
          driveId: "drive-1",
          parents: ["drive-1"],
        }),
      ),
    );

    await expect(pathTo({ id: "specs" }, read)).resolves.toEqual([
      { name: "Shared drives", href: "/shared-drives" },
      { name: "Team", href: "/folder/drive-1" },
      { name: "Specs", href: "/folder/specs" },
    ]);
    expect(read).not.toHaveBeenCalledWith({ id: "root" });
  });

  it("ends at Shared with me where a parent is out of reach", async () => {
    const read = reader(
      metadata(folderItem("Shared", { id: "shared", parents: ["theirs"] })),
      metadata(driveItem("notes.md", { id: "notes", parents: ["shared"] })),
    );

    await expect(pathTo({ id: "notes" }, read)).resolves.toEqual([
      { name: "Shared with me", href: "/shared-with-me" },
      { name: "Shared", href: "/folder/shared" },
      { name: "notes.md", href: "/edit?id=notes" },
    ]);
  });

  it("ends at Shared with me where Drive shows no parent", async () => {
    const read = reader(
      metadata(
        driveItem("alone.md", { id: "alone", parents: [], resourceKey: "k" }),
      ),
    );

    await expect(
      pathTo({ id: "alone", resourceKey: "k" }, read),
    ).resolves.toEqual([
      { name: "Shared with me", href: "/shared-with-me" },
      { name: "alone.md", href: "/edit?id=alone&resourcekey=k" },
    ]);
  });

  it("stops climbing after a hundred folders", async () => {
    const read = reader(
      metadata(folderItem("Loop", { id: "loop", parents: ["loop"] })),
    );

    const path = await pathTo({ id: "loop" }, read);
    expect(path[0]).toEqual({
      name: "Shared with me",
      href: "/shared-with-me",
    });
    // The item, then the hundred folders above it at most.
    expect(path).toHaveLength(102);
  });

  it("fails when Drive fails otherwise", async () => {
    const read = reader(
      metadata(driveItem("plan.md", { id: "plan", parents: ["work"] })),
    );
    const failing = vi.fn((ref: FileRef) =>
      ref.id === "work"
        ? Promise.reject(new DriveError(503, "Backend error"))
        : read(ref),
    );

    await expect(pathTo({ id: "plan" }, failing)).rejects.toMatchObject({
      status: 503,
    });
  });
});
