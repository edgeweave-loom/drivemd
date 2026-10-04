import { describe, expect, it } from "vitest";
import { AuthError } from "./auth.ts";
import { DriveError, TooLargeError } from "./drive.ts";
import {
  createQueryClient,
  refreshAfterChange,
  vaultLinkQuery,
  vaultSettingsQuery,
} from "./queries.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";

function retries(failures: number, error: Error): boolean {
  const { retry } = createQueryClient().getDefaultOptions().queries ?? {};
  if (typeof retry !== "function") throw new Error("No retry rule");
  return retry(failures, error);
}

describe("createQueryClient", () => {
  it.each([
    [new DriveError(0, "Google Drive could not be reached")],
    [new DriveError(429, "Rate limit exceeded")],
    [new DriveError(403, "User Rate Limit Exceeded", "userRateLimitExceeded")],
    [new DriveError(503, "Backend error")],
  ])("tries again after %s", (error) => {
    expect(retries(0, error)).toBe(true);
    expect(retries(1, error)).toBe(true);
    expect(retries(2, error)).toBe(false);
  });

  it.each([
    [new DriveError(404, "File not found")],
    [new DriveError(403, "The user does not have permission")],
    [new DriveError(400, "Not a Drive ID")],
    [new AuthError("superseded", "The user signed out")],
  ])("gives up at once after %s", (error) => {
    expect(retries(0, error)).toBe(false);
  });
});

describe("refreshAfterChange", () => {
  it("has the links in notes found again, as a rename or a move changes where they lead", () => {
    const client = createQueryClient();
    const resolved = ["resolve", "notes", undefined, "plan.md"];
    const linked = ["vault-link", "vault", "notes", undefined, "Plan"];
    const named = ["name", "plan.md"];
    const folders = ["vault-folders", "vault", undefined];
    for (const queryKey of [resolved, linked, named, folders]) {
      client.setQueryData(queryKey, null);
    }

    refreshAfterChange(client, { id: "plan" });

    for (const queryKey of [resolved, linked, named, folders]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });
});

describe("vaultLinkQuery", () => {
  it("reads the vault's folders once, a level at a time, for every link", async () => {
    const drive = fakeDrive();
    const notes = folderItem("Notes", { id: "notes", parents: ["vault"] });
    const deep = folderItem("Deep", { id: "deep", parents: ["notes"] });
    const hidden = folderItem(".trash", { id: "trash", parents: ["vault"] });
    const guide = driveItem("Guide.md", { id: "guide", parents: ["deep"] });
    const lost = driveItem("Guide.md", { id: "lost", parents: ["trash"] });
    drive.listChildren.mockResolvedValue([]);
    drive.listFolders.mockImplementation((folders) =>
      Promise.resolve(
        [notes, deep, hidden].filter(({ parents }) =>
          folders.some(({ id }) => parents.includes(id)),
        ),
      ),
    );
    drive.findByName.mockResolvedValue({
      items: [lost, guide],
      incomplete: false,
    });
    const client = createQueryClient();
    const from = { vault: { id: "vault" }, folder: { id: "elsewhere" } };

    const [one, other] = await Promise.all([
      client.query(vaultLinkQuery(drive, client, from, ["Guide"])),
      client.query(vaultLinkQuery(drive, client, from, ["Deep", "Guide"])),
    ]);
    expect(one.found?.ref.id).toBe("guide");
    expect(other.found?.ref.id).toBe("guide");
    expect(drive.listFolders.mock.calls).toEqual([
      [[{ id: "vault" }]],
      [[{ id: "notes", resourceKey: undefined }]],
      [[{ id: "deep", resourceKey: undefined }]],
    ]);
    expect(drive.findByName).toHaveBeenCalledOnce();
    expect(drive.getMetadata).not.toHaveBeenCalled();
  });
});

describe("vaultSettingsQuery", () => {
  it("gives Obsidian's defaults for a settings file too large to read, which it keeps", async () => {
    const drive = fakeDrive();
    const settings = metadata(
      driveItem("app.json", { id: "app", mimeType: "application/json" }),
    );
    drive.listChildren.mockResolvedValue([settings]);
    drive.getMetadata.mockImplementation(metadataOf(settings));
    drive.getContent.mockRejectedValue(new TooLargeError());
    const client = createQueryClient();

    await expect(
      client.query(vaultSettingsQuery(drive, client, { id: "config" })),
    ).resolves.toEqual({ strictLineBreaks: false });
  });
});
