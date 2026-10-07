import { describe, expect, it } from "vitest";
import type { DriveItem } from "./drive.ts";
import { entriesOf, modifiedLine } from "./listing.ts";
import {
  driveItem as item,
  FOLDER,
  SHORTCUT,
  shortcutItem as shortcut,
} from "./test/drive-items.ts";

function names(items: DriveItem[]) {
  return entriesOf(items).map((entry) => entry.name);
}

describe("entriesOf", () => {
  it("lists folders, then Markdown files, each in natural order", () => {
    expect(
      names([
        item("file10.md"),
        item("Zeta", { mimeType: FOLDER }),
        item("file2.md"),
        item("alpha", { mimeType: FOLDER }),
        item("File1.markdown"),
      ]),
    ).toEqual(["alpha", "Zeta", "File1.markdown", "file2.md", "file10.md"]);
  });

  it("leaves out other files, whatever their MIME type says", () => {
    expect(
      names([
        item("notes.txt", { mimeType: "text/markdown" }),
        item("plain.md", { mimeType: "text/plain" }),
        item("binary.md", { mimeType: "application/octet-stream" }),
        item("doc.md", { mimeType: "application/vnd.google-apps.document" }),
      ]),
    ).toEqual(["binary.md", "plain.md"]);
  });

  it("hides names that start with a dot", () => {
    expect(
      names([
        item(".obsidian", { mimeType: FOLDER }),
        item(".hidden.md"),
        shortcut(".trash", FOLDER),
        item("visible.md"),
      ]),
    ).toEqual(["visible.md"]);
  });

  it("opens a shortcut's target, filed with folders or files by what it points to", () => {
    const entries = entriesOf([
      shortcut("to-note.md", "text/markdown"),
      shortcut("to-folder", FOLDER),
      shortcut("to-doc.md", "application/vnd.google-apps.document"),
      shortcut("to-image", "image/png"),
      item("broken", { mimeType: SHORTCUT }),
    ]);

    expect(entries).toEqual([
      {
        kind: "folder",
        id: "id-to_folder",
        name: "to-folder",
        opens: { id: "target-to-folder", resourceKey: "key" },
        target: {
          id: "target-to-folder",
          mimeType: FOLDER,
          resourceKey: "key",
        },
      },
      {
        kind: "file",
        id: "id-to_note_md",
        name: "to-note.md",
        opens: { id: "target-to-note.md", resourceKey: "key" },
        target: {
          id: "target-to-note.md",
          mimeType: "text/markdown",
          resourceKey: "key",
        },
      },
    ]);
  });

  it("keeps the items' order when asked", () => {
    expect(
      entriesOf(
        [item("b.md"), item("A", { mimeType: FOLDER })],
        "as-listed",
      ).map((entry) => entry.name),
    ).toEqual(["b.md", "A"]);
  });

  it("opens other items themselves, with their resource key", () => {
    expect(entriesOf([item("a.md", { resourceKey: "k" })])[0]?.opens).toEqual({
      id: "id-a_md",
      resourceKey: "k",
    });
  });
});

describe("modifiedLine", () => {
  const [plan] = entriesOf([
    item("plan.md", {
      modifiedTime: "2026-09-01T10:00:00.000Z",
      lastModifiedBy: "Ada Lovelace",
    }),
  ]);

  it("says when and by whom an item last changed", () => {
    expect(plan && modifiedLine(plan)).toBe("Sep 1, 2026, by Ada Lovelace");
  });

  it("names the signed-in user as you", () => {
    const [mine] = entriesOf([
      item("mine.md", {
        modifiedTime: "2026-09-01T10:00:00.000Z",
        lastModifiedBy: "Ada Lovelace",
        lastModifiedByMe: true,
      }),
    ]);
    expect(mine && modifiedLine(mine)).toBe("Sep 1, 2026, by you");
  });

  it("gives the day alone when Drive names nobody", () => {
    const [anyone] = entriesOf([
      item("anyone.md", { modifiedTime: "2026-09-01T10:00:00.000Z" }),
    ]);
    expect(anyone && modifiedLine(anyone)).toBe("Sep 1, 2026");
  });

  it("says nothing without a time, or with one that is no time", () => {
    const entries = entriesOf([
      item("never.md"),
      item("garbled.md", { modifiedTime: "yesterday" }),
    ]);
    expect(entries.map(modifiedLine)).toEqual([undefined, undefined]);
  });
});
