// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { DriveItem, FileRef, SearchResult } from "./drive.ts";
import { driveItem, folderItem, metadata } from "./test/drive-items.ts";
import { resolveInVault, type VaultReader } from "./vault-links.ts";

// A vault in My Drive, and a folder outside it:
//   Vault/Note.md, Vault/Daily/Today.md, Vault/Daily/Note.md,
//   Vault/Deep/Sub/Note.md, Vault/Deep/Sub/Guide.md, Vault/image.png,
//   Vault/v1.2 notes.md, Elsewhere/Note.md
const VAULT = folderItem("Vault", { id: "vault", parents: ["root"] });
const DAILY = folderItem("Daily", { id: "daily", parents: ["vault"] });
const DEEP = folderItem("Deep", { id: "deep", parents: ["vault"] });
const SUB = folderItem("Sub", { id: "sub", parents: ["deep"] });
const ELSEWHERE = folderItem("Elsewhere", { id: "out", parents: ["root"] });
const FILES = [
  driveItem("Note.md", { id: "top-note", parents: ["vault"] }),
  driveItem("Today.md", { id: "today", parents: ["daily"] }),
  driveItem("Note.md", { id: "daily-note", parents: ["daily"] }),
  driveItem("Note.md", { id: "deep-note", parents: ["sub"] }),
  driveItem("Guide.md", { id: "guide", parents: ["sub"] }),
  driveItem("image.png", {
    id: "image",
    mimeType: "image/png",
    parents: ["vault"],
  }),
  driveItem("v1.2 notes.md", { id: "dotted", parents: ["vault"] }),
  driveItem("Note.md", { id: "out-note", parents: ["out"] }),
];
const FOLDERS = [VAULT, DAILY, DEEP, SUB, ELSEWHERE];
const ALL: DriveItem[] = [...FOLDERS, ...FILES];

/** Reads the made-up Drive above, as the app reads Drive. */
function reader(
  changes: { incomplete?: boolean; without?: string[] } = {},
): VaultReader {
  const present = ALL.filter(({ id }) => !changes.without?.includes(id));
  const byId = new Map(present.map((item) => [item.id, item]));
  return {
    children: vi.fn(({ id }: FileRef) =>
      Promise.resolve(present.filter(({ parents }) => parents.includes(id))),
    ),
    parent: vi.fn(({ id }: FileRef) =>
      Promise.resolve(byId.get(id)?.parents[0]),
    ),
    named: vi.fn((name: string): Promise<SearchResult> =>
      Promise.resolve({
        // Drive matches a name whatever its case.
        items: present.filter(
          (item) =>
            item.mimeType !== VAULT.mimeType &&
            item.name.toLowerCase() === name.toLowerCase(),
        ),
        incomplete: changes.incomplete ?? false,
      }),
    ),
    folders: vi.fn(({ id }: FileRef) => {
      const chain = [];
      let parent = byId.get(id)?.parents[0];
      for (let folder = parent && byId.get(parent); folder;) {
        chain.unshift(metadata(folder));
        parent = folder.parents[0];
        folder = parent === undefined ? undefined : byId.get(parent);
      }
      return Promise.resolve(chain);
    }),
  };
}

/** Where a link written in a note of the given folder leads. */
async function lead(
  path: string[],
  folder = "daily",
  read: VaultReader = reader(),
) {
  const { found, incomplete } = await resolveInVault(
    path,
    { vault: { id: "vault" }, folder: { id: folder } },
    read,
  );
  return { id: found?.ref.id, incomplete };
}

describe("resolveInVault", () => {
  it("finds a note by name in the note's own folder first", async () => {
    expect(await lead(["Note"])).toEqual({
      id: "daily-note",
      incomplete: false,
    });
  });

  it("else finds the note with the shortest path in the vault, and none outside it", async () => {
    const read = reader();

    expect(
      await lead(["Note"], "sub", reader({ without: ["deep-note"] })),
    ).toEqual({ id: "top-note", incomplete: false });
    expect(await lead(["guide"], "daily", read)).toEqual({
      id: "guide",
      incomplete: false,
    });
    expect(read.named).toHaveBeenCalledExactlyOnceWith("guide.md");
    expect(
      await lead(
        ["Note"],
        "daily",
        reader({ without: ["top-note", "daily-note", "deep-note"] }),
      ),
    ).toEqual({ id: undefined, incomplete: false });
  });

  it.each([
    ["a note's name with its extension", ["Today.md"], "today"],
    ["a file's name with its extension", ["image.png"], "image"],
    ["a note's name with a dot", ["v1.2 notes"], "dotted"],
    ["a name in another case", ["TODAY"], "today"],
  ])("finds %s", async (_, path, id) => {
    expect((await lead(path)).id).toBe(id);
  });

  it("reads a path from the note's folder first, then from the vault's", async () => {
    expect((await lead(["..", "Note"])).id).toBe("top-note");
    expect((await lead(["Deep", "Sub", "Note"])).id).toBe("deep-note");
    expect((await lead(["deep", "sub", "guide.md"])).id).toBe("guide");
  });

  it("else finds the note whose path ends as the link's does", async () => {
    expect((await lead(["Sub", "Note"])).id).toBe("deep-note");
    expect((await lead(["Daily", "Guide"])).id).toBeUndefined();
  });

  it("says when Drive left some drives out of a search that found nothing", async () => {
    expect(await lead(["Gone"], "daily", reader({ incomplete: true }))).toEqual(
      { id: undefined, incomplete: true },
    );
    expect(
      await lead(["guide"], "daily", reader({ incomplete: true })),
    ).toEqual({ id: "guide", incomplete: false });
  });

  it.each([[[]], [[""]], [["Daily", ""]]])(
    "finds nothing for a path without a name: %j",
    async (path) => {
      const read = reader();

      expect(await lead(path, "daily", read)).toEqual({
        id: undefined,
        incomplete: false,
      });
      expect(read.named).not.toHaveBeenCalled();
    },
  );

  it("gives what opens, with its name and type", async () => {
    const { found } = await resolveInVault(
      ["image.png"],
      { vault: { id: "vault" }, folder: { id: "daily" } },
      reader(),
    );

    expect(found).toEqual({
      ref: { id: "image", resourceKey: undefined },
      name: "image.png",
      mimeType: "image/png",
    });
  });
});
