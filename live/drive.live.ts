import { createHash, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDrive, type DriveAuth, type FileRef } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";
import { configDir, liveSession } from "./grant.ts";

// The Drive client against the real Drive, as the test account (see "Live
// Drive checks" in the README). The checks make what they need in a folder of
// their own and trash it at the end. Every assertion is about one ID, so that
// no failure prints anything else from the account.

const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
/** Made up for the checks, and shared with the test account as a viewer. */
const VIEW_ONLY = "drivemd-live-view-only.md";
/** A shared drive where the test account is a content manager. */
const SHARED_DRIVE = "DriveMD live check";
/** Made up for the checks by another member of that shared drive. */
const FROM_ANOTHER = "drivemd-live-from-another.md";
/** A BOM, CRLF line endings and a byte that is not valid UTF-8. */
const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a, 0xff]);
/** Starts the name of everything the run makes, and finds it by search. */
const RUN = `dmlc${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
/** How long to wait for Drive's search index, which can lag. */
const INDEX = { timeout: 120_000, interval: 3_000 };

const session = await liveSession(configDir());
if (session === undefined) {
  it.skip("needs the test account's grant: see the README", () => undefined);
} else {
  defineChecks(session.auth);
}

function defineChecks(auth: DriveAuth): void {
  const drive = createDrive(auth);
  let run: FileRef = { id: "" };

  /** Calls the API itself, to make or read what the client does not. */
  async function call(method: string, path: string, body?: object) {
    const response = await fetch(`${API}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
    });
    return response;
  }

  /** Drive's JSON answer, or its error message. */
  async function answer(response: Response): Promise<Record<string, unknown>> {
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) return body;
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    const message =
      typeof error.message === "string" ? `: ${error.message}` : "";
    throw new Error(`Drive answered ${String(response.status)}${message}`);
  }

  /** Makes an item, in the run's folder unless `parent` says otherwise. */
  async function make(
    metadata: Record<string, unknown>,
    parent: string | null = run.id,
  ): Promise<string> {
    const parents = parent === null ? {} : { parents: [parent] };
    const made = await answer(
      await call("POST", "files?supportsAllDrives=true&fields=id", {
        ...metadata,
        ...parents,
      }),
    );
    if (typeof made.id !== "string") throw new Error("Drive made no item");
    return made.id;
  }

  function markdown(name: string, mimeType = "text/markdown") {
    return make({ name: `${RUN} ${name}.md`, mimeType });
  }

  /**
   * A Markdown file of the given type. It is made without the .md extension,
   * from which Drive would guess a type when told application/octet-stream,
   * then renamed.
   */
  async function typed(name: string, mimeType: string) {
    const id = await make({ name: `${RUN} ${name}`, mimeType });
    return drive.renameFile({ id }, `${RUN} ${name}.md`);
  }

  function ids(items: { id: string }[]): string[] {
    return items.map(({ id }) => id);
  }

  /** The IDs of the files matching `q` in every drive, found by Drive itself. */
  async function found(q: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({
      q,
      corpora: "allDrives",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      fields: "files(id)",
      ...extra,
    });
    const { files } = await answer(
      await call("GET", `files?${params.toString()}`),
    );
    return (Array.isArray(files) ? files : []).flatMap((file: unknown) =>
      isRecord(file) && typeof file.id === "string" ? [file.id] : [],
    );
  }

  /** Waits until `check` holds, for as long as Drive's index may take. */
  async function eventually(what: string, check: () => Promise<boolean>) {
    await vi.waitFor(async () => {
      if (!(await check())) throw new Error(`Drive does not show ${what} yet`);
    }, INDEX);
  }

  /** The checks' shared drive, shown again if a run left it hidden. */
  async function testDrive(): Promise<FileRef | undefined> {
    const { drives } = await answer(
      await call("GET", "drives?pageSize=100&fields=drives(id,name,hidden)"),
    );
    const listed: unknown = (Array.isArray(drives) ? drives : []).find(
      (item: unknown) => isRecord(item) && item.name === SHARED_DRIVE,
    );
    if (!isRecord(listed) || typeof listed.id !== "string") return;
    if (listed.hidden === true) {
      await answer(await call("POST", `drives/${listed.id}/unhide`));
    }
    return { id: listed.id };
  }

  beforeAll(async () => {
    const folder = { name: `DriveMD live check ${RUN}`, mimeType: FOLDER };
    run = { id: await make(folder, null) };
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
      const opened = await typed(mimeType.replace("/", "-"), mimeType);
      expect(opened.mimeType, "the type of the new file").toBe(mimeType);

      const saved = await drive.saveContent(
        await drive.getMetadata(opened),
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

  it("keeps the revision from before an edit, after the edit", async () => {
    const id = await markdown("revision");
    const before = await drive.saveContent(
      await drive.getMetadata({ id }),
      BYTES,
    );
    const revision = before.headRevisionId;
    if (revision === undefined)
      throw new Error("The saved file has no head revision");

    await drive.keepRevision({ id }, revision);
    await drive.saveContent(before, new Uint8Array([...BYTES, 0x41]));
    const kept = await answer(
      await call(
        "GET",
        `files/${id}/revisions/${revision}?fields=id,keepForever`,
      ),
    );
    expect(kept).toEqual({ id: revision, keepForever: true });
  });

  it("finds Markdown files by name whatever their type, and no Google document", async () => {
    const plain = await typed("found", "application/octet-stream");
    expect(plain.mimeType).toBe("application/octet-stream");
    const doc = await make({
      name: `${RUN} document.md`,
      mimeType: "application/vnd.google-apps.document",
    });
    const named = `name contains '${RUN}' and trashed = false`;

    // Drive's own search must show the document before the client's is asked
    // to leave it out.
    await eventually("the document by name", async () =>
      (await found(named)).includes(doc),
    );
    await eventually("the file found by name", async () =>
      ids(await drive.search(RUN)).includes(plain.id),
    );
    const listed = ids(await drive.search(RUN)).includes(doc);
    expect(listed, "a Google document found as Markdown").toBe(false);
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

    const before = Date.now();
    await drive.markViewed(shared);
    // Drive shows the new time a few seconds later; a few seconds of leeway
    // also cover the gap between this machine's clock and Drive's.
    await eventually("the new view time", async () => {
      const { viewedByMeTime } = await answer(
        await call("GET", `files/${shared.id}?fields=viewedByMeTime`),
      );
      const viewed =
        typeof viewedByMeTime === "string" ? Date.parse(viewedByMeTime) : 0;
      return viewed >= before - 5_000;
    });
  });

  it("follows a shortcut it made, and tells when its target is in the trash", async () => {
    const target = await markdown("target");
    const shortcut = await make({
      name: `${RUN} shortcut.md`,
      mimeType: SHORTCUT,
      shortcutDetails: { targetId: target },
    });

    let reached: FileRef | undefined;
    await eventually("the shortcut in its folder", async () => {
      const listed = await drive.listChildren(run);
      reached = listed.find(({ id }) => id === shortcut)?.target;
      return reached !== undefined;
    });
    if (reached === undefined) throw new Error("The shortcut has no target");
    expect(reached.id).toBe(target);
    await eventually("the shortcut among the user's own", async () =>
      ids(await drive.listShortcuts()).includes(shortcut),
    );
    const followed = {
      ...reached,
      mimeType: "text/markdown",
      resourceKey: undefined,
    };
    await expect(drive.checkShortcut(followed)).resolves.toBeUndefined();
    await drive.trashFile({ id: target });
    await expect(drive.checkShortcut(followed)).resolves.toBe("trashed");
  });

  it("finds a vault by its .obsidian folder", async () => {
    const vault = await make({ name: `${RUN} vault`, mimeType: FOLDER });
    await make({ name: ".obsidian", mimeType: FOLDER }, vault);

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
    await eventually(
      "the trashed file gone from its folder",
      async () =>
        !ids(await drive.listChildren({ id: folder })).includes(moved.id),
    );
  });

  it("lists in a shared drive what another member put there", async (context) => {
    const shared = await testDrive();
    if (!shared)
      return context.skip(`It is in no shared drive named ${SHARED_DRIVE}`);
    // Found by the shared drive's own corpus, which the client never asks for.
    const [theirs] = await found(
      `'${shared.id}' in parents and name = '${FROM_ANOTHER}' and trashed = false`,
      { corpora: "drive", driveId: shared.id },
    );
    if (theirs === undefined) {
      return context.skip(`No ${FROM_ANOTHER} in ${SHARED_DRIVE}`);
    }

    const listed = ids(await drive.listChildren(shared)).includes(theirs);
    expect(listed, "another member's file in the drive's listing").toBe(true);
    const created = await drive.createFile(shared, `${RUN} shared`);
    try {
      expect(created.driveId).toBe(shared.id);
      await eventually("the new file in the drive", async () =>
        ids(await drive.listChildren(shared)).includes(created.id),
      );
    } finally {
      await drive.trashFile(created);
    }
  });

  // Last, since the drive may take a while to show up again.
  it("leaves out a shared drive the user hid", async (context) => {
    const shared = await testDrive();
    if (!shared)
      return context.skip(`It is in no shared drive named ${SHARED_DRIVE}`);

    try {
      await answer(await call("POST", `drives/${shared.id}/hide`));
      await eventually(
        "the hidden drive left out",
        async () => !ids(await drive.listSharedDrives()).includes(shared.id),
      );
    } finally {
      await answer(await call("POST", `drives/${shared.id}/unhide`));
    }
  });
}
