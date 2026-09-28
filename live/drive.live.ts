import { createHash, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDrive, type DriveAuth, type FileRef } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";
import { configDir, liveSession } from "./grant.ts";

// The Drive client against the real Drive, as the test account (see "Live
// Drive checks" in the README). The checks make what they need in a folder of
// their own and trash it at the end. They compare IDs, never listings, so
// that no failure prints the names of other files.

const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
/** Made up for the checks, and shared with the test account as a viewer. */
const VIEW_ONLY = "drivemd-live-view-only.md";
/** A shared drive where the test account is a content manager. */
const SHARED_DRIVE = "DriveMD live check";
/** A BOM, CRLF line endings and a byte that is not valid UTF-8. */
const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a, 0xff]);
/** Starts the name of everything the run makes, and finds it by search. */
const RUN = `dmlc${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

const session = await liveSession(configDir());
if (session === undefined) {
  it.skip("needs the test account's grant: see the README", () => undefined);
} else {
  defineChecks(session.auth);
}

function defineChecks(auth: DriveAuth): void {
  const drive = createDrive(auth);
  let run: FileRef = { id: "" };

  /** Calls the API itself, to make what the client does not. */
  async function call(method: string, path: string, body?: object) {
    return fetch(`${API}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
    });
  }

  /** Makes an item in the run's folder, unless `metadata` says where. */
  async function make(metadata: Record<string, unknown>): Promise<string> {
    const response = await call("POST", "files?supportsAllDrives=true", {
      parents: [run.id],
      ...metadata,
    });
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.id !== "string") {
      throw new Error(`Drive made no item: ${String(response.status)}`);
    }
    return body.id;
  }

  function markdown(name: string, mimeType = "text/markdown") {
    return make({ name: `${RUN} ${name}.md`, mimeType });
  }

  function ids(items: { id: string }[]): string[] {
    return items.map(({ id }) => id);
  }

  /** Waits for Drive's search index, which can take a while. */
  async function eventually(what: string, check: () => Promise<boolean>) {
    for (let tries = 0; tries < 40; tries += 1) {
      if (await check()) return;
      await sleep(3000);
    }
    throw new Error(`Drive never showed ${what}`);
  }

  async function sharedDrive() {
    const drives = await drive.listSharedDrives();
    return drives.find(({ name }) => name === SHARED_DRIVE);
  }

  beforeAll(async () => {
    run = {
      id: await make({
        name: `DriveMD live check ${RUN}`,
        mimeType: FOLDER,
        parents: [],
      }),
    };
  });

  afterAll(async () => {
    if (run.id !== "") await drive.trashFile(run);
  });

  it("gets every query past Drive", async () => {
    await drive.listChildren(run);
    await drive.listSharedDrives();
    await drive.listSharedWithMe();
    await drive.listShortcuts();
    await drive.listRecent();
    await drive.search(RUN);
    await drive.findVaults();
  });

  it.each(["text/markdown", "text/plain", "application/octet-stream"])(
    "keeps the type of a file saved as %s, and its exact bytes",
    async (mimeType) => {
      const id = await markdown(mimeType.replace("/", "-"), mimeType);

      const saved = await drive.saveContent(
        await drive.getMetadata({ id }),
        BYTES,
      );
      expect(saved.mimeType).toBe(mimeType);
      expect(saved.md5Checksum).toBe(
        createHash("md5").update(BYTES).digest("hex"),
      );
      await expect(drive.getContent(saved)).resolves.toEqual(BYTES);
    },
  );

  it("downloads from the Drive API itself, with no redirect for the CSP to block", async () => {
    const id = await markdown("download");
    await drive.saveContent(await drive.getMetadata({ id }), BYTES);

    const response = await call(
      "GET",
      `files/${id}?alt=media&supportsAllDrives=true`,
    );
    expect(response.status).toBe(200);
  });

  it("keeps the revision from before an edit", async () => {
    const id = await markdown("revision");
    const first = await drive.saveContent(
      await drive.getMetadata({ id }),
      BYTES,
    );
    const revision = first.headRevisionId ?? "";

    await drive.keepRevision({ id }, revision);
    const kept: unknown = await (
      await call("GET", `files/${id}/revisions/${revision}?fields=keepForever`)
    ).json();
    expect(isRecord(kept) && kept.keepForever).toBe(true);
  });

  it("finds Markdown files by name whatever their type, and no Google document", async () => {
    const plain = await markdown("found", "application/octet-stream");
    const doc = await make({
      name: `${RUN} document.md`,
      mimeType: "application/vnd.google-apps.document",
    });

    await eventually("the file found by name", async () =>
      ids(await drive.search(RUN)).includes(plain),
    );
    expect(ids(await drive.search(RUN))).not.toContain(doc);
  });

  it("lists in Recent the files viewed last, newest first", async () => {
    const older = await markdown("older");
    const newer = await markdown("newer");

    await drive.markViewed({ id: older });
    await sleep(2000);
    await drive.markViewed({ id: newer });
    await eventually("both files in Recent, newest first", async () => {
      const recent = ids(await drive.listRecent());
      const [first, second] = [recent.indexOf(newer), recent.indexOf(older)];
      return first >= 0 && second > first;
    });
  });

  it("marks a file it can only view as viewed", async (context) => {
    const shared = (await drive.listSharedWithMe()).find(
      ({ name }) => name === VIEW_ONLY,
    );
    if (!shared) return context.skip(`No ${VIEW_ONLY} is shared with it`);
    expect(shared.capabilities.canEdit).toBe(false);

    await drive.markViewed(shared);
    const viewed: unknown = await (
      await call("GET", `files/${shared.id}?fields=viewedByMeTime`)
    ).json();
    const time = isRecord(viewed)
      ? Date.parse(String(viewed.viewedByMeTime))
      : 0;
    expect(Date.now() - time).toBeLessThan(120_000);
  });

  it("follows a shortcut it made, and tells when its target is in the trash", async () => {
    const target = await markdown("target");
    const shortcut = await make({
      name: `${RUN} shortcut.md`,
      mimeType: SHORTCUT,
      shortcutDetails: { targetId: target },
    });

    const listed = (await drive.listChildren(run)).find(
      ({ id }) => id === shortcut,
    );
    if (!listed?.target)
      throw new Error("The shortcut came without its target");
    expect(listed.target.id).toBe(target);
    await eventually("the shortcut among the user's own", async () =>
      ids(await drive.listShortcuts()).includes(shortcut),
    );
    await expect(drive.checkShortcut(listed.target)).resolves.toBeUndefined();
    await drive.trashFile({ id: target });
    await expect(drive.checkShortcut(listed.target)).resolves.toBe("trashed");
  });

  it("finds a vault by its .obsidian folder", async () => {
    const vault = await make({ name: `${RUN} vault`, mimeType: FOLDER });
    await make({ name: ".obsidian", mimeType: FOLDER, parents: [vault] });

    await eventually("the vault", async () =>
      ids(await drive.findVaults()).includes(vault),
    );
  });

  it("creates, renames, moves and trashes a file", async () => {
    const folder = await make({ name: `${RUN} folder`, mimeType: FOLDER });

    const created = await drive.createFile(run, "Untitled");
    expect(created.name).toBe("Untitled.md");
    const renamed = await drive.renameFile(created, `${RUN} renamed.md`);
    expect(renamed.name).toBe(`${RUN} renamed.md`);
    const moved = await drive.moveFile(renamed, { id: folder });
    expect(moved.parents).toEqual([folder]);
    await drive.trashFile(moved);
    expect(ids(await drive.listChildren({ id: folder }))).not.toContain(
      moved.id,
    );
  });

  it("works in a shared drive", async (context) => {
    const shared = await sharedDrive();
    if (!shared)
      return context.skip(`It is in no shared drive named ${SHARED_DRIVE}`);

    const created = await drive.createFile(shared, `${RUN} shared`);
    try {
      expect(created.driveId).toBe(shared.id);
      expect(ids(await drive.listChildren(shared))).toContain(created.id);
    } finally {
      await drive.trashFile(created);
    }
  });

  // Last, since the drive may take a while to show up again.
  it("leaves out a shared drive the user hid", async (context) => {
    const shared = await sharedDrive();
    if (!shared)
      return context.skip(`It is in no shared drive named ${SHARED_DRIVE}`);

    try {
      expect((await call("POST", `drives/${shared.id}/hide`)).ok).toBe(true);
      await eventually(
        "the hidden drive left out",
        async () => !ids(await drive.listSharedDrives()).includes(shared.id),
      );
    } finally {
      await call("POST", `drives/${shared.id}/unhide`);
    }
  });
}
