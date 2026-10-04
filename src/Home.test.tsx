import "fake-indexeddb/auto";
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDraft, deleteDrafts, listDrafts, writeDraft } from "./drafts.ts";
import { DriveError, type FileMetadata } from "./drive.ts";
import { Home } from "./Home.tsx";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { ACCOUNT, renderWithDrive } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }));
const SHARED = metadata(
  driveItem("shared.md", { id: "shared", resourceKey: "key-1" }),
);

/** Unsaved changes to the note, kept on the device when given. */
function keep(
  file: FileMetadata,
  keptAt = "2026-10-02T09:00:00.000Z",
  account = ACCOUNT,
) {
  return writeDraft(account, {
    fileId: file.id,
    name: file.name,
    resourceKey: file.resourceKey,
    headRevisionId: file.headRevisionId,
    md5Checksum: file.md5Checksum,
    text: "Changed",
    keptAt,
  });
}

/** Home, with Recent and Vaults empty and Drive's details of the files. */
function home(...files: FileMetadata[]) {
  const drive = fakeDrive();
  drive.listRecent.mockResolvedValue([]);
  drive.findVaults.mockResolvedValue([]);
  drive.getMetadata.mockImplementation(metadataOf(...files));
  return renderWithDrive(<Home />, drive);
}

beforeEach(async () => {
  await deleteDrafts(ACCOUNT);
  await deleteDrafts("grace@example.com");
});

afterEach(() => {
  onlineManager.setOnline(true);
});

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

/** The section of unsaved changes, once the device has answered. */
async function unsaved() {
  return within(await screen.findByRole("region", { name: "Unsaved changes" }));
}

function linksIn(name: string) {
  return section(name)
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("Home", () => {
  it("shows the files opened last, newest first, then vaults and roots", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockResolvedValue([
      driveItem("zeta.md"),
      driveItem("alpha.md"),
    ]);
    drive.findVaults.mockResolvedValue([
      metadata(folderItem("Work notes")),
      metadata(folderItem("Journal")),
    ]);
    renderWithDrive(<Home />, drive);

    expect(
      await section("Recent").findByRole("link", { name: "zeta.md" }),
    ).toBeVisible();
    expect(linksIn("Recent")).toEqual(["zeta.md", "alpha.md"]);
    await section("Vaults").findByRole("link", { name: "Journal" });
    expect(linksIn("Vaults")).toEqual(["Journal", "Work notes"]);
    expect(linksIn("Browse")).toEqual([
      "My Drive",
      "Shortcuts",
      "Shared drives",
      "Shared with me",
    ]);
  });

  it("says what fills Recent and Vaults when they are empty", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockResolvedValue([]);
    drive.findVaults.mockResolvedValue([]);
    renderWithDrive(<Home />, drive);

    expect(
      await section("Recent").findByText(
        "The Markdown files you view, here or in Google Drive, show here.",
      ),
    ).toBeVisible();
    expect(
      await section("Vaults").findByText(
        "No Obsidian vault in your Drive: a vault is a folder with a .obsidian folder in it.",
      ),
    ).toBeVisible();
  });

  it.each([
    ["Recent", "Vaults"],
    ["Vaults", "Recent"],
  ])("keeps %s's failure out of %s", async (failing, working) => {
    const drive = fakeDrive();
    const lists = { Recent: drive.listRecent, Vaults: drive.findVaults };
    lists[failing as keyof typeof lists].mockRejectedValue(
      new DriveError(503, "Backend error"),
    );
    lists[working as keyof typeof lists].mockResolvedValue([
      metadata(folderItem("Journal")),
    ]);
    renderWithDrive(<Home />, drive);

    expect(await section(failing).findByRole("alert")).toHaveTextContent(
      "Backend error",
    );
    expect(
      await section(working).findByRole("link", { name: "Journal" }),
    ).toBeVisible();
  });

  it("keeps each section apart when Drive fails for one", async () => {
    const drive = fakeDrive();
    drive.listRecent.mockRejectedValue(new DriveError(503, "Backend error"));
    drive.findVaults.mockResolvedValue([metadata(folderItem("Journal"))]);
    renderWithDrive(<Home />, drive);

    expect(await section("Recent").findByRole("alert")).toHaveTextContent(
      "Backend error",
    );
    expect(
      await section("Vaults").findByRole("link", { name: "Journal" }),
    ).toBeVisible();
  });

  it("lists the notes with unsaved changes first, the latest first, by Drive's name", async () => {
    await keep(PLAN, "2026-10-02T09:00:00.000Z");
    await keep(SHARED, "2026-10-03T09:00:00.000Z");
    // Renamed since its changes were kept.
    home(PLAN, { ...SHARED, name: "renamed.md" });

    const region = await screen.findByRole("region", {
      name: "Unsaved changes",
    });
    expect(screen.getAllByRole("region")[0]).toBe(region);
    expect(
      await within(region).findByRole("link", { name: /^renamed\.md/ }),
    ).toHaveAttribute("href", "/edit?id=shared&resourcekey=key-1");
    expect(linksIn("Unsaved changes")).toEqual([
      expect.stringMatching(/^renamed\.md/),
      expect.stringMatching(/^plan\.md/),
    ]);
    expect(
      section("Unsaved changes").getByRole("link", { name: /^plan\.md/ }),
    ).toHaveAttribute("href", "/edit?id=plan");
    expect(section("Unsaved changes").getAllByRole("time")[0]).toHaveAttribute(
      "datetime",
      "2026-10-03T09:00:00.000Z",
    );
    expect(
      section("Unsaved changes").queryByRole("button", { name: /^Discard/ }),
    ).toBeNull();
  });

  it("lists a note by the name it had until Drive's details come", async () => {
    await keep(PLAN);
    const { drive } = home();
    drive.getMetadata.mockReturnValue(new Promise(() => undefined));

    expect(
      await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
    ).toBeVisible();
  });

  it("names a note kept before drafts held names as Drive does, or plainly", async () => {
    await writeDraft(ACCOUNT, {
      fileId: "plan",
      text: "Changed",
      keptAt: "2026-10-02T09:00:00.000Z",
    } as Parameters<typeof writeDraft>[1]);
    await writeDraft(ACCOUNT, {
      fileId: "lost",
      text: "Changed",
      keptAt: "2026-10-01T09:00:00.000Z",
    } as Parameters<typeof writeDraft>[1]);
    const { drive } = home();
    drive.getMetadata.mockImplementation((file) =>
      file.id === "plan"
        ? Promise.resolve(PLAN)
        : Promise.reject(new DriveError(503, "Backend error")),
    );

    expect(
      await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
    ).toBeVisible();
    expect(
      await section("Unsaved changes").findByRole("link", { name: /^Note/ }),
    ).toHaveAttribute("href", "/edit?id=lost");
  });

  it("lists the signed-in account's notes only", async () => {
    await keep(PLAN);
    await keep(SHARED, "2026-10-03T09:00:00.000Z", "grace@example.com");
    home(PLAN, SHARED);

    await (await unsaved()).findByRole("link", { name: /^plan\.md/ });
    expect(linksIn("Unsaved changes")).toEqual([
      expect.stringMatching(/^plan\.md/),
    ]);
  });

  it("lists the notes while the device is offline", async () => {
    await keep(PLAN);
    onlineManager.setOnline(false);
    home(PLAN);

    expect(
      await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
    ).toBeVisible();
  });

  it("shows no such section on a device that keeps nothing", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    home();

    await section("Recent").findByText(
      "The Markdown files you view, here or in Google Drive, show here.",
    );
    expect(
      screen.queryByRole("region", { name: "Unsaved changes" }),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it("reads the device afresh each time it shows", async () => {
    await keep(PLAN);
    const { rerender } = home(PLAN);
    await (await unsaved()).findByRole("link", { name: /^plan\.md/ });
    rerender(<p>Elsewhere</p>);
    // Saved or discarded on the note's page.
    await deleteDraft(ACCOUNT, "plan");

    rerender(<Home />);

    await section("Recent").findByText(
      "The Markdown files you view, here or in Google Drive, show here.",
    );
    expect(
      screen.queryByRole("region", { name: "Unsaved changes" }),
    ).toBeNull();
  });

  it.each<[string, FileMetadata | undefined, string]>([
    ["deleted", undefined, "Deleted, or not shared with you"],
    ["trashed", { ...PLAN, trashed: true }, "In the trash"],
    [
      "not downloadable",
      {
        ...PLAN,
        capabilities: { ...PLAN.capabilities, canDownload: false },
      },
      "Its owner does not let you download it",
    ],
    ["too large", { ...PLAN, size: 1_200_000 }, "Over 1 MB"],
    ["renamed", { ...PLAN, name: "plan.txt" }, "Not a Markdown file"],
  ])(
    "says why a note %s cannot open, and discards its changes once the user agrees",
    async (_, now, reason) => {
      await keep(PLAN);
      await keep(SHARED, "2026-10-01T09:00:00.000Z");
      home(SHARED, ...(now ? [now] : []));

      expect(await (await unsaved()).findByText(reason)).toBeVisible();
      expect(
        section("Unsaved changes").queryByRole("link", { name: /^plan/ }),
      ).toBeNull();
      fireEvent.click(
        section("Unsaved changes").getByRole("button", {
          name: /^Discard plan/,
        }),
      );
      const dialog = within(
        screen.getByRole("dialog", { name: "Discard unsaved changes?" }),
      );
      fireEvent.click(dialog.getByRole("button", { name: "Discard" }));

      await waitFor(() => {
        expect(screen.queryByText(reason)).toBeNull();
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(linksIn("Unsaved changes")).toEqual([
        expect.stringMatching(/^shared\.md/),
      ]);
      expect((await listDrafts(ACCOUNT)).map(({ fileId }) => fileId)).toEqual([
        "shared",
      ]);
    },
  );

  it("leaves a note kept before drafts held names as a link, as its 404 may come from a missing resource key", async () => {
    await writeDraft(ACCOUNT, {
      fileId: "shared",
      text: "Changed",
      keptAt: "2026-10-02T09:00:00.000Z",
    } as Parameters<typeof writeDraft>[1]);
    home();

    expect(
      await (await unsaved()).findByRole("link", { name: /^Note/ }),
    ).toHaveAttribute("href", "/edit?id=shared");
    expect(
      section("Unsaved changes").queryByRole("button", { name: /^Discard/ }),
    ).toBeNull();
  });

  it.each<[string, FileMetadata]>([
    ["locked", { ...PLAN, locked: true }],
    [
      "view only",
      {
        ...PLAN,
        capabilities: { ...PLAN.capabilities, canModifyContent: false },
      },
    ],
  ])(
    "leaves a note that is %s as a link, as its page offers the changes back",
    async (_, now) => {
      await keep(PLAN);
      const { drive } = home(now);

      await waitFor(() => {
        expect(drive.getMetadata).toHaveBeenCalled();
      });
      expect(
        await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
      ).toBeVisible();
      await new Promise((settle) => setTimeout(settle, 50));
      expect(
        section("Unsaved changes").queryByRole("button", { name: /^Discard/ }),
      ).toBeNull();
    },
  );

  it("asks Drive afresh whether a note opens each time Home shows", async () => {
    await keep(PLAN);
    const { drive, client, rerender } = home({ ...PLAN, trashed: true });
    // Drive's answers stay fresh for half a minute, as in the app.
    client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
    await (await unsaved()).findByText("In the trash");
    rerender(<p>Elsewhere</p>);
    // Restored from Drive's trash.
    drive.getMetadata.mockImplementation(metadataOf(PLAN));

    rerender(<Home />);

    expect(
      await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
    ).toBeVisible();
  });

  it("waits for Drive's answer since Home showed before offering Discard", async () => {
    await keep(PLAN);
    const { drive, rerender } = home({ ...PLAN, trashed: true });
    await (await unsaved()).findByText("In the trash");
    rerender(<p>Elsewhere</p>);
    // Restored from Drive's trash, which Drive has yet to say.
    drive.getMetadata.mockReturnValue(new Promise(() => undefined));

    rerender(<Home />);

    expect(
      await (await unsaved()).findByRole("link", { name: /^plan\.md/ }),
    ).toBeVisible();
    expect(
      section("Unsaved changes").queryByRole("button", { name: /^Discard/ }),
    ).toBeNull();
  });

  it("says a note is gone once Drive no longer finds it, whatever it said before", async () => {
    await keep(PLAN);
    const { drive, rerender } = home(PLAN);
    await (await unsaved()).findByRole("link", { name: /^plan\.md/ });
    rerender(<p>Elsewhere</p>);
    drive.getMetadata.mockImplementation(metadataOf());

    rerender(<Home />);

    expect(
      await (await unsaved()).findByText("Deleted, or not shared with you"),
    ).toBeVisible();
  });

  it("names the note each Discard is for", async () => {
    await keep(PLAN);
    home({ ...PLAN, trashed: true });

    expect(
      await (await unsaved()).findByRole("button", { name: "Discard plan.md" }),
    ).toHaveAccessibleDescription("In the trash");
  });

  it("discards while the device is offline", async () => {
    await keep(PLAN);
    home({ ...PLAN, trashed: true });
    fireEvent.click(
      await (await unsaved()).findByRole("button", { name: "Discard plan.md" }),
    );
    onlineManager.setOnline(false);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Discard",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await expect(listDrafts(ACCOUNT)).resolves.toEqual([]);
  });

  it("says when it could not discard, keeps the changes, and asks afresh", async () => {
    await keep(PLAN);
    home({ ...PLAN, trashed: true });
    const refusal = vi
      .spyOn(IDBObjectStore.prototype, "delete")
      .mockImplementation(() => {
        throw new DOMException("Lost", "UnknownError");
      });
    fireEvent.click(
      await (await unsaved()).findByRole("button", { name: "Discard plan.md" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Discard" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Something went wrong.",
    );
    refusal.mockRestore();
    await expect(listDrafts(ACCOUNT)).resolves.toHaveLength(1);
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      section("Unsaved changes").getByRole("button", {
        name: "Discard plan.md",
      }),
    );

    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("keeps the changes when the user cancels", async () => {
    await keep(PLAN);
    home({ ...PLAN, trashed: true });

    fireEvent.click(
      await (await unsaved()).findByRole("button", { name: "Discard plan.md" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(section("Unsaved changes").getByText("In the trash")).toBeVisible();
    await expect(listDrafts(ACCOUNT)).resolves.toHaveLength(1);
  });
});
