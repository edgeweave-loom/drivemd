import { createHash, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDrive, type DriveAuth, type FileRef } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";
import { MAX_CONTENT } from "../src/queries.ts";
import { saveText } from "../src/save.ts";
import { toggleTask } from "../src/tasks.ts";
import { decode, encode } from "../src/text.ts";
import {
  driveApi,
  FOLDER,
  FROM_ANOTHER,
  INDEX_INTERVAL_MS,
  INDEX_TIMEOUT_MS,
  SHARED_DRIVE,
  SHORTCUT,
} from "./drive-api.ts";
import { configDir, liveSession } from "./grant.ts";

// The Drive client against the real Drive, as the test account (see "Live
// Drive checks" in the README). The checks make what they need in a folder of
// their own and trash it at the end. Every assertion is about one ID, so that
// no failure prints anything else from the account.

/** Made up for the checks, and shared with the test account as a viewer. */
const VIEW_ONLY = "drivemd-live-view-only.md";
/** A BOM, CRLF line endings and a byte that is not valid UTF-8. */
const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a, 0xff]);
/** Starts the name of everything the run makes, and finds it by search. */
const RUN = `dmlc${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const INDEX = { timeout: INDEX_TIMEOUT_MS, interval: INDEX_INTERVAL_MS };

const session = await liveSession(configDir());
if (session === undefined) {
  it.skip("needs the test account's grant: see the README", () => undefined);
} else {
  defineChecks(session.auth);
}

function defineChecks(auth: DriveAuth): void {
  const drive = createDrive(auth);
  let run: FileRef = { id: "" };

  const { call, answer, make: makeItem } = driveApi(auth);

  /** Makes an item, in the run's folder unless `parent` says otherwise. */
  function make(
    metadata: Record<string, unknown>,
    parent: string | null = run.id,
  ): Promise<string> {
    return makeItem(
      parent === null ? metadata : { ...metadata, parents: [parent] },
    );
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
    await drive.findByName(`${RUN}.md`);
    await drive.findVaults();
    await drive.findVaultConfigs();
  });

  it("finds a file by its exact name, whatever its case", async () => {
    const name = `${RUN} Name's check.md`;
    const id = await make({ name, mimeType: "text/markdown" });

    await eventually("the file by its exact name", async () =>
      ids((await drive.findByName(name)).items).includes(id),
    );
    // Obsidian finds a note whatever the case of the link.
    const other = await drive.findByName(name.toUpperCase());
    expect(ids(other.items), "the file found in capitals").toContain(id);
  });

  it("finds a file by a name with accents, in small letters too", async () => {
    // Drive matches the case of ASCII letters only: the client asks for the
    // name with capital initials too.
    const name = `${RUN} Été.md`;
    const id = await make({ name, mimeType: "text/markdown" });

    await eventually("the file by its accented name", async () =>
      ids((await drive.findByName(name)).items).includes(id),
    );
    const lower = await drive.findByName(name.toLowerCase());
    expect(ids(lower.items), "the file found in small letters").toContain(id);
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
      expect(saved.size).toBe(BYTES.length);
      await expect(drive.getContent(saved, BYTES.length)).resolves.toEqual(
        BYTES,
      );
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
      ids((await drive.search(RUN)).items).includes(plain.id),
    );
    const listed = ids((await drive.search(RUN)).items).includes(doc);
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

  it("names no folder of a file shared alone that the account cannot reach", async (context) => {
    const shared = (await drive.listSharedWithMe()).find(
      ({ name }) => name === VIEW_ONLY,
    );
    if (!shared) return context.skip(`No ${VIEW_ONLY} is shared with it`);

    // So a note's vault above a folder out of reach cannot be found.
    const { parents } = await drive.getMetadata(shared);
    const reached = await Promise.all(
      parents.map((id) =>
        drive.getMetadata({ id }).then(
          () => true,
          () => false,
        ),
      ),
    );
    expect(reached, "whether each folder Drive names opens").not.toContain(
      false,
    );
  });

  /**
   * A file another tool wrote: made as plain text, then given its bytes
   * through the API, and opened as the app opens one.
   */
  async function written(name: string, content: Uint8Array<ArrayBuffer>) {
    const made = await typed(name, "text/plain");
    await drive.saveContent(await drive.getMetadata(made), content);
    return drive.getMetadata(made);
  }

  const utf8 = (text: string) => new TextEncoder().encode(text);
  const BOM = [0xef, 0xbb, 0xbf];

  it.each([
    [
      "CRLF line breaks and a byte order mark",
      new Uint8Array([
        ...BOM,
        ...utf8("# Plan\r\n\r\n- [ ] Boil\r\n- [ ] Pour\r\n"),
      ]),
    ],
    [
      "LF line breaks, the last one left out",
      utf8("# Plan\n\n- [ ] Boil\n- [ ] Pour"),
    ],
    ["CR line breaks", utf8("# Plan\r\r- [ ] Boil\r- [ ] Pour\r")],
  ])(
    "saves a task checked in a file another tool wrote with %s, changing that one byte",
    async (name, content) => {
      const opened = await written(name.split(" ")[0] ?? name, content);
      const bytes = await drive.getContent(opened, MAX_CONTENT);
      expect(bytes, "the bytes as written").toEqual(content);
      const text = decode(bytes);
      expect(text.readOnly).toBeUndefined();
      expect(encode(text.text, text), "the bytes decoded and encoded").toEqual(
        content,
      );

      const checked = toggleTask(text.text, text.text.indexOf("- [ ] Pour"));
      if (checked === undefined) throw new Error("No task to check");
      const result = await saveText(drive, opened, encode(checked, text), {
        keep: true,
      });
      expect("saved" in result, "a save without a conflict").toBe(true);

      const after = await drive.getContent(
        await drive.getMetadata(opened),
        MAX_CONTENT,
      );
      // The space between the brackets of "- [ ] Pour", and that alone.
      const task = utf8("- [ ] Pour");
      const at = content.findIndex((_, index) =>
        task.every((byte, offset) => content[index + offset] === byte),
      );
      const expected = content.slice();
      expected[at + 3] = 0x78;
      expect(after, "the bytes saved").toEqual(expected);
      const kept = await answer(
        await call(
          "GET",
          `files/${opened.id}/revisions/${opened.headRevisionId ?? ""}?fields=keepForever`,
        ),
      );
      expect(kept.keepForever, "the revision from before kept").toBe(true);
    },
  );

  it("shows a file that is not UTF-8 read-only, with its bytes as they are", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const opened = await written("latin1", latin1);

    const bytes = await drive.getContent(opened, MAX_CONTENT);

    expect(bytes).toEqual(latin1);
    expect(decode(bytes).readOnly).toBe("not-utf8");
  });

  it("writes nothing over someone else's change, and says so", async () => {
    const opened = await written("conflict", utf8("- [ ] Boil\n"));
    // Someone else saves meanwhile.
    await drive.saveContent(opened, utf8("- [ ] Boil\n- [ ] Serve\n"));

    const result = await saveText(drive, opened, utf8("- [x] Boil\n"), {
      keep: true,
    });

    expect("conflict" in result, "a conflict found").toBe(true);
    await expect(
      drive.getContent(await drive.getMetadata(opened), MAX_CONTENT),
    ).resolves.toEqual(utf8("- [ ] Boil\n- [ ] Serve\n"));
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
