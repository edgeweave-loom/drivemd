import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DriveError,
  TooLargeError,
  type DriveItem,
  type FileMetadata,
} from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
  MY_DRIVE_ROOT,
} from "./test/drive-items.ts";
import { fakeDrive, type FakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

const VAULT = metadata(
  folderItem("Journal", { id: "vault", parents: [MY_DRIVE_ROOT.id] }),
);
const CONFIG = folderItem(".obsidian", { id: "config", parents: ["vault"] });
const DAILY = metadata(
  folderItem("Daily", { id: "daily", parents: ["vault"] }),
);
const NOTE = metadata(
  driveItem("Today.md", { id: "note", parents: ["daily"] }),
);
const SETTINGS = metadata(
  driveItem("app.json", {
    id: "app",
    mimeType: "application/json",
    parents: ["config"],
  }),
);
const ELSEWHERE = metadata(
  folderItem("Notes", { id: "notes", parents: [MY_DRIVE_ROOT.id] }),
);
const PLAIN = metadata(
  driveItem("Plain.md", { id: "plain", parents: ["notes"] }),
);

const TEXT = "one\ntwo";

function utf8(text: string) {
  return new TextEncoder().encode(text);
}

/**
 * Opens a note in a Drive that holds the Journal vault, with `settings` as
 * its app.json, or none when null; `prepare` changes Drive's answers first.
 */
function open(
  note: FileMetadata,
  {
    settings = "{}",
    folders = {},
    items = [],
    prepare = () => undefined,
  }: {
    settings?: string | Error | null;
    folders?: Record<string, DriveItem[]>;
    items?: FileMetadata[];
    prepare?: (drive: FakeDrive) => void;
  } = {},
) {
  const drive = fakeDrive();
  drive.findVaults.mockResolvedValue([VAULT]);
  drive.getMetadata.mockImplementation(
    metadataOf(VAULT, DAILY, NOTE, SETTINGS, ELSEWHERE, PLAIN, ...items),
  );
  const listed: Record<string, DriveItem[]> = {
    vault: [CONFIG, DAILY],
    config: settings === null ? [] : [SETTINGS],
    ...folders,
  };
  drive.listChildren.mockImplementation((folder) =>
    Promise.resolve(listed[folder.id] ?? []),
  );
  drive.getContent.mockImplementation((file) => {
    if (file.id !== SETTINGS.id) return Promise.resolve(utf8(TEXT));
    if (settings instanceof Error) return Promise.reject(settings);
    return Promise.resolve(utf8(settings ?? ""));
  });
  prepare(drive);
  return renderWithDrive(<FileContent file={note} />, drive);
}

/** The line breaks in the rendered note's first paragraph. */
async function breaks() {
  const paragraph = await screen.findByText(/one/, { selector: "p" });
  return paragraph.querySelectorAll("br").length;
}

describe("a note in an Obsidian vault", () => {
  it("shows a single line break as one, as Obsidian does", async () => {
    open(NOTE);

    expect(await breaks()).toBe(1);
  });

  it("joins the lines as Markdown does when the vault's strictLineBreaks is on", async () => {
    const { drive } = open(NOTE, { settings: '{"strictLineBreaks": true}' });

    expect(await breaks()).toBe(0);
    expect(drive.getContent).toHaveBeenCalledWith(SETTINGS, 100_000);
  });

  it.each([
    ["has no settings file", null],
    ["has a settings file that is not JSON", "{strictLineBreaks"],
    ["sets strictLineBreaks to something else", '{"strictLineBreaks": 1}'],
    ["has a settings file that is too large", new TooLargeError()],
    ["has a settings file Drive fails to send", new DriveError(500, "Oops")],
  ])("follows Obsidian's defaults when the vault %s", async (_, settings) => {
    open(NOTE, { settings });

    expect(await breaks()).toBe(1);
  });

  it("follows the settings of the vault nearest the note", async () => {
    const inner = metadata(
      folderItem("Inner", { id: "inner", parents: ["vault"] }),
    );
    const innerConfig = folderItem(".obsidian", {
      id: "inner-config",
      parents: ["inner"],
    });
    const note = metadata(
      driveItem("Deep.md", { id: "deep", parents: ["inner"] }),
    );
    open(note, {
      settings: '{"strictLineBreaks": true}',
      folders: { inner: [innerConfig] },
      items: [inner, note],
      prepare: (drive) => {
        drive.findVaults.mockResolvedValue([VAULT, inner]);
      },
    });

    expect(await breaks()).toBe(1);
  });

  it("waits to know whether the note is in a vault before showing it", async () => {
    open(NOTE, {
      prepare: (drive) => {
        drive.findVaults.mockReturnValue(new Promise(() => undefined));
      },
    });

    expect(await screen.findByText("Loading…")).toBeVisible();
    expect(screen.queryByText(/one/)).toBeNull();
  });
});

describe("a note outside any vault", () => {
  it("joins the lines as Markdown does", async () => {
    open(PLAIN);

    expect(await breaks()).toBe(0);
    expect(screen.queryByText(/could not check/)).toBeNull();
  });

  it("reads no folder of the note's when Drive holds no vault", async () => {
    const { drive } = open(PLAIN, {
      prepare: (fake) => {
        fake.findVaults.mockResolvedValue([]);
      },
    });

    expect(await breaks()).toBe(0);
    expect(drive.getMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ["the vaults", "findVaults"],
    ["the note's folders", "getMetadata"],
  ] as const)(
    "shows as Markdown does, and says so, when Drive fails to send %s",
    async (_, call) => {
      open(NOTE, {
        prepare: (drive) => {
          drive[call].mockRejectedValue(new DriveError(500, "Oops"));
        },
      });

      expect(await breaks()).toBe(0);
      await waitFor(() => {
        expect(
          screen.getByText(
            "DriveMD could not check whether this note is in an Obsidian vault, so it shows as Markdown, without Obsidian's syntax.",
          ),
        ).toBeVisible();
      });
    },
  );
});
