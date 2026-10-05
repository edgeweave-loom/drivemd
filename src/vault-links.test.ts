// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { DriveItem, FileRef, SearchResult } from "./drive.ts";
import { driveItem, folderItem, shortcutItem } from "./test/drive-items.ts";
import { resolveInVault, type VaultReader } from "./vault-links.ts";

// A vault in My Drive, and a folder outside it:
//   Vault/Note.md, Vault/plan.md, Vault/Plan.md, Vault/v2.0/, Vault/Doc,
//   Vault/image.png, Vault/Short.md (a shortcut), Vault/Sub/Guide.md,
//   Vault/Daily/Today.md, Vault/Daily/Note.md, Vault/Daily/v1.2.md,
//   Vault/Daily/Sub/Guide.md, Vault/Deep/Sub/Note.md, Vault/Deep/Sub/Guide.md,
//   Vault/A/Twin.md, Vault/B/Twin.md, Vault/.trash/Lost.md,
//   Elsewhere/Secret.md
const FOLDERS = [
  folderItem("Vault", { id: "vault", parents: ["root"] }),
  folderItem("Daily", { id: "daily", parents: ["vault"] }),
  folderItem("Sub", { id: "daily-sub", parents: ["daily"] }),
  folderItem("Deep", { id: "deep", parents: ["vault"] }),
  folderItem("Sub", { id: "deep-sub", parents: ["deep"] }),
  folderItem("Sub", { id: "root-sub", parents: ["vault"] }),
  folderItem("A", { id: "a", parents: ["vault"] }),
  folderItem("B", { id: "b", parents: ["vault"] }),
  folderItem(".trash", { id: "trash", parents: ["vault"] }),
  folderItem("v2.0", { id: "dotted-folder", parents: ["vault"] }),
  folderItem("Elsewhere", { id: "out", parents: ["root"] }),
];
const FILES = [
  driveItem("Note.md", { id: "top-note", parents: ["vault"] }),
  driveItem("plan.md", { id: "lower-plan", parents: ["vault"] }),
  driveItem("Plan.md", { id: "upper-plan", parents: ["vault"] }),
  driveItem("Doc", {
    id: "doc",
    mimeType: "application/vnd.google-apps.document",
    parents: ["vault"],
  }),
  driveItem("Today.md", { id: "today", parents: ["daily"] }),
  driveItem("Note.md", { id: "daily-note", parents: ["daily"] }),
  driveItem("v1.2.md", { id: "dotted-note", parents: ["daily"] }),
  driveItem("Guide.md", { id: "daily-guide", parents: ["daily-sub"] }),
  driveItem("Note.md", { id: "deep-note", parents: ["deep-sub"] }),
  driveItem("Guide.md", { id: "deep-guide", parents: ["deep-sub"] }),
  driveItem("Guide.md", { id: "root-guide", parents: ["root-sub"] }),
  driveItem("Twin.md", { id: "a-twin", parents: ["a"] }),
  driveItem("Twin.md", { id: "b-twin", parents: ["b"] }),
  driveItem("image.png", {
    id: "image",
    mimeType: "image/png",
    parents: ["vault"],
  }),
  driveItem("Lost.md", { id: "lost", parents: ["trash"] }),
  driveItem("Secret.md", { id: "secret", parents: ["out"] }),
  { ...shortcutItem("Short.md", "text/markdown"), parents: ["vault"] },
];
const ALL: DriveItem[] = [...FOLDERS, ...FILES];

/** The vault's folders, as the app lists them: none under a dot folder. */
const TREE = new Map<string, string[]>([
  ["vault", []],
  ["daily", ["Daily"]],
  ["daily-sub", ["Daily", "Sub"]],
  ["deep", ["Deep"]],
  ["deep-sub", ["Deep", "Sub"]],
  ["root-sub", ["Sub"]],
  ["a", ["A"]],
  ["b", ["B"]],
  ["dotted-folder", ["v2.0"]],
]);

/** Reads the made-up Drive above, as the app reads Drive. */
function reader(
  changes: {
    incomplete?: boolean;
    without?: string[];
    reversed?: boolean;
  } = {},
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
    named: vi.fn((name: string): Promise<SearchResult> => {
      // Drive matches a name whatever its case, in an order of its own.
      const items = present.filter(
        (item) =>
          !item.mimeType.startsWith("application/vnd.google-apps.") &&
          item.name.toLowerCase() === name.toLowerCase(),
      );
      if (changes.reversed) items.reverse();
      return Promise.resolve({
        items,
        incomplete: changes.incomplete ?? false,
      });
    }),
    folders: vi.fn(() => Promise.resolve(TREE)),
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
  it("finds a note by name in the note's own folder first, asking nothing else", async () => {
    const read = reader();

    expect(await lead(["Note"], "daily", read)).toEqual({
      id: "daily-note",
      incomplete: false,
    });
    expect(read.named).not.toHaveBeenCalled();
    expect(read.folders).not.toHaveBeenCalled();
  });

  it("else finds the note with the shortest path in the vault", async () => {
    const read = reader();

    expect(await lead(["guide"], "a", read)).toEqual({
      id: "root-guide",
      incomplete: false,
    });
    expect(read.named).toHaveBeenCalledExactlyOnceWith("guide.md");
    expect(
      (await lead(["Note"], "a", reader({ without: ["top-note"] }))).id,
    ).toBe("daily-note");
  });

  it("finds none outside the vault, nor in a folder Obsidian leaves out", async () => {
    expect((await lead(["Secret"])).id).toBeUndefined();
    expect((await lead(["Lost"])).id).toBeUndefined();
  });

  it("takes the same note whatever order Drive answers in", async () => {
    expect((await lead(["Twin"])).id).toBe("a-twin");
    expect((await lead(["Twin"], "daily", reader({ reversed: true }))).id).toBe(
      "a-twin",
    );
  });

  it("prefers the name written in the same case", async () => {
    expect((await lead(["Plan"], "vault")).id).toBe("upper-plan");
    expect((await lead(["plan"], "vault")).id).toBe("lower-plan");
    expect((await lead(["Plan"], "a")).id).toBe("upper-plan");
    expect((await lead(["plan"], "a", reader({ reversed: true }))).id).toBe(
      "lower-plan",
    );
  });

  it.each([
    ["a note's name with its extension", ["Today.md"], "today"],
    ["a file's name with its extension", ["image.png"], "image"],
    ["a name in another case", ["TODAY"], "today"],
  ])("finds %s", async (_, path, id) => {
    expect((await lead(path)).id).toBe(id);
  });

  it("finds a note whose name has a dot in its folder before a file of that name elsewhere", async () => {
    const read = reader();

    expect((await lead(["v1.2"], "daily", read)).id).toBe("dotted-note");
    expect(read.named).not.toHaveBeenCalled();
  });

  it("reads a path from the note's folder first, then from the vault's", async () => {
    expect((await lead(["Sub", "Guide"])).id).toBe("daily-guide");
    expect((await lead(["Sub", "Guide"], "deep")).id).toBe("deep-guide");
    expect((await lead(["sub", "GUIDE.md"], "vault")).id).toBe("root-guide");
    expect((await lead(["..", "Note"])).id).toBe("top-note");
  });

  it("else finds the note whose path ends as the link's does", async () => {
    expect((await lead(["Deep", "Sub", "Note"], "a")).id).toBe("deep-note");
    expect((await lead(["deep", "sub", "note"], "a")).id).toBe("deep-note");
    expect((await lead(["Sub", "Note"], "a")).id).toBe("deep-note");
    expect((await lead(["A", "Note"])).id).toBeUndefined();
  });

  it.each([
    ["a folder", ["v2.0"], "vault"],
    ["a Google document", ["Doc"], "vault"],
    ["a shortcut", ["Short.md"], "vault"],
    ["a folder at the end of a path", ["..", "v2.0"], "daily"],
  ])("leads to no %s", async (_, path, folder) => {
    expect((await lead(path, folder)).id).toBeUndefined();
  });

  it("leads nowhere out of the vault", async () => {
    expect((await lead(["..", "Elsewhere", "Secret"], "vault")).id).toBe(
      undefined,
    );
    expect((await lead(["..", "..", "Elsewhere", "Secret"])).id).toBe(
      undefined,
    );
  });

  it("says when Drive left some drives out of a search that found nothing", async () => {
    expect(await lead(["Gone"], "daily", reader({ incomplete: true }))).toEqual(
      { id: undefined, incomplete: true },
    );
    expect(await lead(["Twin"], "daily", reader({ incomplete: true }))).toEqual(
      { id: "a-twin", incomplete: false },
    );
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
