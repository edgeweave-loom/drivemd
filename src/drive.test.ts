import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDrive,
  DriveError,
  getAccountEmail,
  isMarkdown,
  type DriveAuth,
  type FileRef,
} from "./drive.ts";

const TOKEN = "example-access-token";
const NEW_TOKEN = "example-renewed-token";
const ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

/** Answers each Drive call with the next response, in order. */
function respond(...responses: Response[]): void {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
}

function refusal(status: number, message?: string): Response {
  return Response.json({ error: { message } }, { status });
}

function sent(call = 0) {
  const [url, init] = vi.mocked(fetch).mock.calls[call] ?? [];
  if (typeof url !== "string") throw new Error(`No call #${String(call)}`);
  return { url: new URL(url), headers: new Headers(init?.headers), init };
}

/** The JSON body of a Drive call. */
function sentJson(call = 0): unknown {
  const { body } = sent(call).init ?? {};
  if (typeof body !== "string")
    throw new Error(`No JSON in call #${String(call)}`);
  return JSON.parse(body);
}

/** Hands out TOKEN, then NEW_TOKEN as if the user had tapped Continue. */
function fakeAuth(): DriveAuth {
  return {
    token: vi
      .fn<DriveAuth["token"]>()
      .mockResolvedValueOnce(TOKEN)
      .mockResolvedValue(NEW_TOKEN),
    forget: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAccountEmail", () => {
  it("asks Drive for the signed-in user's email with the token as a bearer", async () => {
    answer(200, { user: { emailAddress: "ada@example.com" } });

    await expect(getAccountEmail(TOKEN)).resolves.toBe("ada@example.com");
    expect(fetch).toHaveBeenCalledWith(ABOUT_URL, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
  });

  it("reports Drive's status and message when it refuses", async () => {
    answer(403, { error: { message: "Drive API is disabled" } });

    const error: unknown = await getAccountEmail(TOKEN).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DriveError);
    expect(error).toMatchObject({
      status: 403,
      message: "Drive API is disabled",
    });
  });

  it("tells an expired or revoked token apart", async () => {
    answer(401, { error: { message: "Invalid Credentials" } });

    await expect(getAccountEmail(TOKEN)).rejects.toMatchObject({ status: 401 });
  });

  it("reports the status of an answer that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("Bad Gateway", { status: 502 })),
      ),
    );

    await expect(getAccountEmail(TOKEN)).rejects.toMatchObject({
      status: 502,
      message: "Google Drive answered 502",
    });
  });

  it.each([{}, { user: { emailAddress: "" } }, null])(
    "rejects an answer without an email: %j",
    async (body) => {
      answer(200, body);

      await expect(getAccountEmail(TOKEN)).rejects.toBeInstanceOf(DriveError);
    },
  );

  it("reports a network failure without the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError(`Failed: Bearer ${TOKEN}`))),
    );

    const error: unknown = await getAccountEmail(TOKEN).catch(
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

const FILE = { id: "file-1", name: "notes.md", mimeType: "text/markdown" };
const NOTHING_GRANTED = {
  canAddChildren: false,
  canComment: false,
  canDownload: false,
  canEdit: false,
  canModifyContent: false,
  canMoveItemOutOfDrive: false,
  canMoveItemWithinDrive: false,
  canRename: false,
  canTrash: false,
};

function getMetadata(file: FileRef = { id: "file-1" }, auth = fakeAuth()) {
  return createDrive(auth).getMetadata(file);
}

describe("Drive calls", () => {
  it("keep Drive's answers out of the browser's cache", async () => {
    respond(Response.json(FILE));

    await getMetadata();
    expect(sent().init?.cache).toBe("no-store");
  });

  it("send the token as a bearer, and only in the Authorization header", async () => {
    respond(Response.json(FILE));

    await getMetadata();
    expect(sent().headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sent().url.href).not.toContain(TOKEN);
  });

  it("wait for a token, and do not reach Drive without one", async () => {
    respond();
    const auth = fakeAuth();
    const signedOut = new Error("The user signed out");
    vi.mocked(auth.token).mockReset().mockRejectedValue(signedOut);

    await expect(getMetadata(undefined, auth)).rejects.toBe(signedOut);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forget a refused token, and retry once with a new one", async () => {
    respond(refusal(401, "Invalid Credentials"), Response.json(FILE));
    const auth = fakeAuth();

    await expect(getMetadata(undefined, auth)).resolves.toMatchObject(FILE);
    expect(auth.forget).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(sent(1).headers.get("Authorization")).toBe(`Bearer ${NEW_TOKEN}`);
    expect(sent(1).url).toEqual(sent(0).url);
  });

  it("forget the new token too when Drive refuses it, and report it", async () => {
    respond(refusal(401), refusal(401, "Invalid Credentials"));
    const auth = fakeAuth();

    await expect(getMetadata(undefined, auth)).rejects.toMatchObject({
      name: "DriveError",
      status: 401,
      message: "Invalid Credentials",
    });
    expect(vi.mocked(auth.forget).mock.calls).toEqual([[TOKEN], [NEW_TOKEN]]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fail with the token's error when no new token comes", async () => {
    respond(refusal(401));
    const auth = fakeAuth();
    const signedOut = new Error("The user signed out");
    vi.mocked(auth.token).mockRejectedValue(signedOut);

    await expect(getMetadata(undefined, auth)).rejects.toBe(signedOut);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [refusal(404, "File not found: file-1."), "File not found: file-1."],
    [refusal(403), "Google Drive answered 403"],
    [new Response("Bad Gateway", { status: 502 }), "Google Drive answered 502"],
  ])(
    "report Drive's status and message when it refuses: %#",
    async (response, message) => {
      respond(response);

      await expect(getMetadata()).rejects.toMatchObject({
        name: "DriveError",
        status: response.status,
        message,
      });
    },
  );

  it("report a network failure without the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError(`Failed: Bearer ${TOKEN}`))),
    );

    const error = await getMetadata().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DriveError);
    expect(error).toMatchObject({
      status: 0,
      message: "Google Drive could not be reached",
    });
  });

  it("send the resource key of an item shared by link", async () => {
    respond(Response.json(FILE));

    await getMetadata({ id: "file-1", resourceKey: "key-1" });
    expect(sent().headers.get("X-Goog-Drive-Resource-Keys")).toBe(
      "file-1/key-1",
    );
  });

  it.each([undefined, ""])(
    "send no resource key header when the key is %j",
    async (resourceKey) => {
      respond(Response.json(FILE));

      await getMetadata({ id: "file-1", resourceKey });
      expect(sent().headers.has("X-Goog-Drive-Resource-Keys")).toBe(false);
    },
  );

  it.each(["", ".", "..", "x/../../about", "x?fields=*", "x#y", "x&y", "x y"])(
    "refuse an ID that could reach another endpoint or parameter: %j",
    async (id) => {
      respond(Response.json(FILE));
      const auth = fakeAuth();

      await expect(getMetadata({ id }, auth)).rejects.toMatchObject({
        name: "DriveError",
        status: 400,
        message: "Not a Drive ID",
      });
      expect(auth.token).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

const ITEM_FIELDS =
  "id,name,mimeType,resourceKey,parents,driveId," +
  "shortcutDetails(targetId,targetMimeType,targetResourceKey)," +
  "capabilities(canAddChildren,canComment,canDownload,canEdit," +
  "canModifyContent,canMoveItemOutOfDrive,canMoveItemWithinDrive," +
  "canRename,canTrash),contentRestrictions(readOnly,reason)";
const FILE_FIELDS =
  `${ITEM_FIELDS},modifiedTime,lastModifyingUser(displayName),` +
  "md5Checksum,headRevisionId";

describe("getMetadata", () => {
  it("asks for what the viewer shows and the conflict check compares, in any drive", async () => {
    respond(Response.json(FILE));

    await getMetadata();
    const { url, init } = sent();
    expect(init?.method).toBeUndefined();
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toBe(FILE_FIELDS);
  });

  it("reads the file", async () => {
    respond(
      Response.json({
        ...FILE,
        resourceKey: "key-1",
        parents: ["folder-1"],
        driveId: "drive-1",
        capabilities: { canEdit: true, canRename: true, canShare: true },
        modifiedTime: "2026-09-01T10:00:00.000Z",
        lastModifyingUser: { displayName: "Ada Lovelace" },
        md5Checksum: "0cc175b9c0f1b6a831c399e269772661",
        headRevisionId: "revision-1",
      }),
    );

    await expect(getMetadata()).resolves.toEqual({
      ...FILE,
      resourceKey: "key-1",
      parents: ["folder-1"],
      driveId: "drive-1",
      target: undefined,
      capabilities: { ...NOTHING_GRANTED, canEdit: true, canRename: true },
      locked: false,
      lockReason: undefined,
      modifiedTime: "2026-09-01T10:00:00.000Z",
      lastModifiedBy: "Ada Lovelace",
      md5Checksum: "0cc175b9c0f1b6a831c399e269772661",
      headRevisionId: "revision-1",
    });
  });

  it.each([
    [{}, {}],
    [
      {
        resourceKey: "",
        parents: ["folder-1", 7],
        capabilities: { canEdit: "yes" },
        lastModifyingUser: {},
      },
      { parents: ["folder-1"] },
    ],
  ])(
    "denies what Drive does not grant, and leaves out what it does not send: %j",
    async (sentFields, readFields) => {
      respond(Response.json({ ...FILE, ...sentFields }));

      await expect(getMetadata()).resolves.toEqual({
        ...FILE,
        resourceKey: undefined,
        parents: [],
        driveId: undefined,
        target: undefined,
        capabilities: NOTHING_GRANTED,
        locked: false,
        lockReason: undefined,
        modifiedTime: undefined,
        lastModifiedBy: undefined,
        md5Checksum: undefined,
        headRevisionId: undefined,
        ...readFields,
      });
    },
  );

  it("reads where a shortcut points", async () => {
    respond(
      Response.json({
        id: "shortcut-1",
        name: "plans",
        mimeType: "application/vnd.google-apps.shortcut",
        shortcutDetails: {
          targetId: "folder-2",
          targetMimeType: "application/vnd.google-apps.folder",
          targetResourceKey: "key-2",
        },
      }),
    );

    await expect(getMetadata({ id: "shortcut-1" })).resolves.toMatchObject({
      target: {
        id: "folder-2",
        mimeType: "application/vnd.google-apps.folder",
        resourceKey: "key-2",
      },
    });
  });

  it.each([
    "unexpected",
    { targetId: "file-2" },
    { targetMimeType: "text/markdown" },
  ])("leaves out a target it cannot follow: %j", async (shortcutDetails) => {
    respond(Response.json({ ...FILE, shortcutDetails }));

    await expect(getMetadata()).resolves.toMatchObject({ target: undefined });
  });

  it("reads why a file is locked", async () => {
    respond(
      Response.json({
        ...FILE,
        contentRestrictions: [
          "unexpected",
          { readOnly: false, reason: "Draft" },
          { readOnly: true },
          { readOnly: true, reason: "Final version" },
        ],
      }),
    );

    await expect(getMetadata()).resolves.toMatchObject({
      locked: true,
      lockReason: "Final version",
    });
  });

  it.each([
    [[{ readOnly: true }], true],
    [{ readOnly: true }, false],
  ])(
    "reads a lock without a reason, and only from a list: %j",
    async (contentRestrictions, locked) => {
      respond(Response.json({ ...FILE, contentRestrictions }));

      await expect(getMetadata()).resolves.toMatchObject({
        locked,
        lockReason: undefined,
      });
    },
  );

  it.each([
    ["null", Response.json(null)],
    ["a numeric ID", Response.json({ ...FILE, id: 1 })],
    ["no name", Response.json({ ...FILE, name: undefined })],
    ["no MIME type", Response.json({ ...FILE, mimeType: null })],
    ["a page instead of JSON", new Response("<!doctype html>")],
  ])("rejects a malformed answer: %s", async (_, response) => {
    respond(response);

    await expect(getMetadata()).rejects.toMatchObject({
      name: "DriveError",
      status: 200,
      message: "Google Drive sent an unexpected answer",
    });
  });
});

describe("getContent", () => {
  /** Opens the file as the viewer does: its metadata, then its bytes. */
  async function open(file: FileRef = { id: "file-1" }, auth = fakeAuth()) {
    const drive = createDrive(auth);
    return drive.getContent(await drive.getMetadata(file));
  }

  it("downloads the file's bytes exactly as stored, in any drive", async () => {
    // A BOM, CRLF line endings and a byte that is not valid UTF-8.
    const bytes = [0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41, 0x0d, 0x0a, 0xff];
    respond(
      Response.json({ ...FILE, resourceKey: "key-1" }),
      new Response(new Uint8Array(bytes)),
    );

    await expect(open({ id: "file-1", resourceKey: "key-1" })).resolves.toEqual(
      new Uint8Array(bytes),
    );
    const { url, headers } = sent(1);
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      alt: "media",
      supportsAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
  });

  it("renews a refused token for a download too", async () => {
    respond(
      Response.json(FILE),
      refusal(401),
      new Response(new Uint8Array([0x41])),
    );
    const auth = fakeAuth();

    await expect(open(undefined, auth)).resolves.toEqual(
      new Uint8Array([0x41]),
    );
    expect(auth.forget).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reports Drive's refusal", async () => {
    respond(
      Response.json(FILE),
      refusal(403, "The user does not have sufficient permissions."),
    );

    await expect(open()).rejects.toMatchObject({
      name: "DriveError",
      status: 403,
      message: "The user does not have sufficient permissions.",
    });
  });

  it("reports an interrupted download as a network failure", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new TypeError(`Failed: Bearer ${TOKEN}`));
      },
    });
    respond(Response.json(FILE), new Response(broken));

    await expect(open()).rejects.toMatchObject({
      name: "DriveError",
      status: 0,
      message: "Google Drive could not be reached",
    });
  });
});

describe("listChildren", () => {
  function listChildren(folder: FileRef = { id: "folder-1" }) {
    return createDrive(fakeAuth()).listChildren(folder);
  }

  it("lists what the folder holds outside the trash, in any drive", async () => {
    respond(Response.json({ files: [FILE, { ...FILE, id: "file-2" }] }));

    await expect(
      listChildren({ id: "folder-1", resourceKey: "key-1" }),
    ).resolves.toMatchObject([{ id: "file-1" }, { id: "file-2" }]);
    const { url, headers } = sent();
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "'folder-1' in parents and trashed = false",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("folder-1/key-1");
  });

  it("follows every page of a large folder", async () => {
    respond(
      Response.json({ files: [FILE], nextPageToken: "page-2" }),
      Response.json({ files: [{ ...FILE, id: "file-2" }] }),
    );

    await expect(listChildren()).resolves.toMatchObject([
      { id: "file-1" },
      { id: "file-2" },
    ]);
    expect(sent(0).url.searchParams.has("pageToken")).toBe(false);
    expect(sent(1).url.searchParams.get("pageToken")).toBe("page-2");
    expect(sent(1).url.searchParams.get("q")).toBe(
      sent(0).url.searchParams.get("q"),
    );
  });

  it.each([{}, { files: [] }])("reads an empty folder: %j", async (body) => {
    respond(Response.json(body));

    await expect(listChildren()).resolves.toEqual([]);
  });

  it("skips an entry it cannot read, and lists the others", async () => {
    respond(
      Response.json({
        files: [FILE, { ...FILE, id: 7 }, null, { ...FILE, id: "file-2" }],
      }),
    );

    await expect(listChildren()).resolves.toMatchObject([
      { id: "file-1" },
      { id: "file-2" },
    ]);
  });

  it.each([{ files: "notes.md" }, { files: { 0: FILE } }, null])(
    "rejects a malformed page: %j",
    async (body) => {
      respond(Response.json(body));

      await expect(listChildren()).rejects.toMatchObject({
        name: "DriveError",
        message: "Google Drive sent an unexpected answer",
      });
    },
  );

  it("refuses a folder ID that could change the query", async () => {
    respond();

    await expect(
      listChildren({ id: "x' in parents or name contains '" }),
    ).rejects.toMatchObject({ name: "DriveError", status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("listSharedDrives", () => {
  it("lists the shared drives the user is a member of and has not hidden", async () => {
    respond(
      Response.json({
        drives: [{ id: "drive-1", name: "Team" }],
        nextPageToken: "page-2",
      }),
      Response.json({ drives: [{ id: "drive-2", name: "Operations" }] }),
    );

    await expect(createDrive(fakeAuth()).listSharedDrives()).resolves.toEqual([
      { id: "drive-1", name: "Team" },
      { id: "drive-2", name: "Operations" },
    ]);
    const { url } = sent();
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/drives",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "hidden = false",
      fields: "nextPageToken,drives(id,name)",
      pageSize: "100",
    });
    expect(sent(1).url.searchParams.get("pageToken")).toBe("page-2");
  });

  it("skips a drive it cannot read", async () => {
    respond(
      Response.json({
        drives: [
          { id: "drive-1" },
          { id: 1, name: "Team" },
          { id: "drive-2", name: "Operations" },
        ],
      }),
    );

    await expect(createDrive(fakeAuth()).listSharedDrives()).resolves.toEqual([
      { id: "drive-2", name: "Operations" },
    ]);
  });

  it("rejects a malformed page", async () => {
    respond(Response.json({ drives: 5 }));

    await expect(
      createDrive(fakeAuth()).listSharedDrives(),
    ).rejects.toMatchObject({ name: "DriveError", status: 200 });
  });
});

// Google's own types (Docs, folders, shortcuts...) have no content to edit.
const WITH_CONTENT = "not mimeType contains 'application/vnd.google-apps.'";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

describe("isMarkdown", () => {
  it.each([
    ["notes.md", true],
    ["Notes.MD", true],
    ["plan.markdown", true],
    ["notes.md.pdf", false],
    ["md", false],
    ["notes.mdx", false],
  ])("%s: %s", (name, expected) => {
    expect(isMarkdown(name)).toBe(expected);
  });
});

describe("listRecent", () => {
  it("lists the Markdown files among the 100 files viewed last, in every drive", async () => {
    respond(
      Response.json({
        files: [
          { ...FILE, id: "file-1", name: "b.md" },
          { ...FILE, id: "file-2", name: "report.pdf" },
          { ...FILE, id: "file-3", name: "a.markdown" },
        ],
      }),
    );

    const recent = await createDrive(fakeAuth()).listRecent();
    expect(recent.map(({ id }) => id)).toEqual(["file-1", "file-3"]);
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({
      q: `viewedByMeTime > '1970-01-01T00:00:00' and trashed = false and ${WITH_CONTENT}`,
      orderBy: "viewedByMeTime desc",
      corpora: "allDrives",
      pageSize: "100",
      fields: `files(${ITEM_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
  });
});

describe("search", () => {
  it("finds Markdown files with a word starting with the text, in every drive", async () => {
    respond(
      Response.json({
        files: [
          { ...FILE, name: "planning.md" },
          { ...FILE, id: "file-2", name: "plan.docx" },
        ],
      }),
    );

    await expect(createDrive(fakeAuth()).search(" plan ")).resolves.toEqual([
      expect.objectContaining({ name: "planning.md" }),
    ]);
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({
      q: `name contains 'plan' and trashed = false and ${WITH_CONTENT}`,
      orderBy: "modifiedTime desc",
      corpora: "allDrives",
      pageSize: "100",
      fields: `files(${ITEM_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
  });

  it("needs every word of the text, in any order", async () => {
    respond(Response.json({ files: [] }));

    await createDrive(fakeAuth()).search(" weekly  plan ");
    expect(sent().url.searchParams.get("q")).toBe(
      "name contains 'weekly' and name contains 'plan' " +
        `and trashed = false and ${WITH_CONTENT}`,
    );
  });

  it("keeps quotes and backslashes in the text from changing the query", async () => {
    respond(Response.json({ files: [] }));

    await createDrive(fakeAuth()).search("Ada's\\notes' or");
    expect(sent().url.searchParams.get("q")).toBe(
      "name contains 'Ada\\'s\\\\notes\\'' and name contains 'or' " +
        `and trashed = false and ${WITH_CONTENT}`,
    );
  });

  it("finds nothing for blank text, without asking Drive", async () => {
    respond();

    await expect(createDrive(fakeAuth()).search("  ")).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("findVaults", () => {
  /** Answers the search for .obsidian folders, then each folder's metadata. */
  function answerVaults(parents: string[][], refused: Record<string, number>) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const { pathname } = new URL(url);
        if (pathname.endsWith("/files")) {
          const files = parents.map((ids, index) => ({
            ...FILE,
            id: `obsidian-${String(index)}`,
            name: ".obsidian",
            mimeType: FOLDER,
            parents: ids,
          }));
          return Promise.resolve(Response.json({ files }));
        }
        const id = pathname.split("/").at(-1) ?? "";
        const status = refused[id];
        return Promise.resolve(
          status === undefined
            ? Response.json({ id, name: `Vault ${id}`, mimeType: FOLDER })
            : refusal(status),
        );
      }),
    );
  }

  it("finds the folders that hold an .obsidian folder, in every drive", async () => {
    answerVaults([["vault-1"], ["vault-2"], ["vault-1"], []], {});

    const vaults = await createDrive(fakeAuth()).findVaults();
    expect(vaults.map(({ id, name }) => [id, name])).toEqual([
      ["vault-1", "Vault vault-1"],
      ["vault-2", "Vault vault-2"],
    ]);
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({
      q: `name = '.obsidian' and mimeType = '${FOLDER}' and trashed = false`,
      corpora: "allDrives",
      pageSize: "1000",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
  });

  it("leaves out a vault whose folder the user cannot open", async () => {
    answerVaults([["vault-1"], ["vault-2"]], { "vault-2": 404 });

    const vaults = await createDrive(fakeAuth()).findVaults();
    expect(vaults.map(({ id }) => id)).toEqual(["vault-1"]);
  });

  // Drive also answers 403 when it limits the rate of requests.
  it.each([403, 500])(
    "fails when a vault's folder answers %i",
    async (status) => {
      answerVaults([["vault-1"]], { "vault-1": status });

      await expect(createDrive(fakeAuth()).findVaults()).rejects.toMatchObject({
        name: "DriveError",
        status,
      });
    },
  );
});

describe("listSharedWithMe", () => {
  it("lists the folders, shortcuts and files with content shared with the user", async () => {
    respond(Response.json({ files: [FILE] }));

    await expect(
      createDrive(fakeAuth()).listSharedWithMe(),
    ).resolves.toMatchObject([FILE]);
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({
      q:
        "sharedWithMe and trashed = false and " +
        `(mimeType = '${FOLDER}' or ` +
        `mimeType = '${SHORTCUT}' or ` +
        `${WITH_CONTENT})`,
      pageSize: "1000",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
  });
});

describe("listShortcuts", () => {
  it("lists the shortcuts the user owns, wherever they are", async () => {
    const shortcut = {
      id: "shortcut-1",
      name: "plans",
      mimeType: SHORTCUT,
      shortcutDetails: { targetId: "folder-2", targetMimeType: FOLDER },
    };
    respond(Response.json({ files: [shortcut] }));

    await expect(createDrive(fakeAuth()).listShortcuts()).resolves.toEqual([
      expect.objectContaining({
        id: "shortcut-1",
        target: { id: "folder-2", mimeType: FOLDER, resourceKey: undefined },
      }),
    ]);
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({
      q: `mimeType = '${SHORTCUT}' and 'me' in owners and trashed = false`,
      pageSize: "1000",
      fields: `nextPageToken,files(${ITEM_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
  });
});

describe("checkShortcut", () => {
  const TARGET = {
    id: "file-2",
    mimeType: "text/markdown",
    resourceKey: "key-2",
  };

  function checkShortcut() {
    return createDrive(fakeAuth()).checkShortcut(TARGET);
  }

  it("finds nothing wrong with a target the user can open", async () => {
    respond(Response.json({ trashed: false }));

    await expect(checkShortcut()).resolves.toBeUndefined();
    const { url, headers } = sent();
    expect(url.pathname).toBe("/drive/v3/files/file-2");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: "trashed",
      supportsAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-2/key-2");
  });

  it("reports a target in the trash", async () => {
    respond(Response.json({ trashed: true }));

    await expect(checkShortcut()).resolves.toBe("trashed");
  });

  it.each([{}, { trashed: "true" }])(
    "counts only a real true as in the trash: %j",
    async (body) => {
      respond(Response.json(body));

      await expect(checkShortcut()).resolves.toBeUndefined();
    },
  );

  it("rejects a malformed answer", async () => {
    respond(Response.json(null));

    await expect(checkShortcut()).rejects.toMatchObject({
      name: "DriveError",
      status: 200,
    });
  });

  it("reports a target that was deleted or is not shared with the user", async () => {
    respond(refusal(404, "File not found: file-2."));

    await expect(checkShortcut()).resolves.toBe("missing");
  });

  it("fails when Drive fails otherwise, leaving the shortcut as it is", async () => {
    respond(refusal(403, "Rate Limit Exceeded"));

    await expect(checkShortcut()).rejects.toMatchObject({
      name: "DriveError",
      status: 403,
    });
  });
});

describe("saveContent", () => {
  // A BOM and CRLF line endings, which the upload must keep.
  const CONTENT = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a]);
  const OPENED = { ...FILE, mimeType: "text/x-markdown", resourceKey: "key-1" };

  /** Opens the file as the editor does, then saves CONTENT over it. */
  async function save(auth = fakeAuth()) {
    const drive = createDrive(auth);
    const file = await drive.getMetadata({
      id: "file-1",
      resourceKey: "key-1",
    });
    return drive.saveContent(file, CONTENT);
  }

  it("uploads the bytes as they are, with the file's own type, and reads the new revision", async () => {
    respond(
      Response.json({ ...OPENED, headRevisionId: "revision-1" }),
      Response.json({ ...OPENED, headRevisionId: "revision-2" }),
    );

    await expect(save()).resolves.toMatchObject({
      headRevisionId: "revision-2",
    });
    const { url, headers, init } = sent(1);
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/upload/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      uploadType: "media",
      fields: FILE_FIELDS,
      supportsAllDrives: "true",
    });
    expect(headers.get("Content-Type")).toBe("text/x-markdown");
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
    expect(init?.body).toEqual(CONTENT);
  });

  // Waiting for a new token can take a tap on Continue, long after the
  // conflict check: the save must check again before it retries.
  it("forgets a refused token without saving again", async () => {
    respond(Response.json(OPENED), refusal(401, "Invalid Credentials"));
    const auth = fakeAuth();
    vi.mocked(auth.token)
      .mockReset()
      .mockResolvedValueOnce(TOKEN)
      .mockResolvedValueOnce(TOKEN)
      .mockResolvedValue(NEW_TOKEN);

    await expect(save(auth)).rejects.toMatchObject({
      name: "DriveError",
      status: 401,
    });
    expect(auth.forget).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(auth.token).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports Drive's refusal", async () => {
    respond(
      Response.json(OPENED),
      refusal(403, "The user does not have sufficient permissions for file-1."),
    );

    await expect(save()).rejects.toMatchObject({
      name: "DriveError",
      status: 403,
    });
  });
});

describe("keepRevision", () => {
  it("keeps the revision forever, whatever Drive cleans up", async () => {
    respond(Response.json({ id: "revision-1" }));

    await createDrive(fakeAuth()).keepRevision(
      { id: "file-1", resourceKey: "key-1" },
      "revision-1",
    );
    const { url, headers, init } = sent();
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1/revisions/revision-1",
    );
    // The revisions calls take no supportsAllDrives: they work in every drive.
    expect(Object.fromEntries(url.searchParams)).toEqual({ fields: "id" });
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
    expect(sentJson()).toEqual({ keepForever: true });
  });

  it("refuses a revision ID that could reach another endpoint", async () => {
    respond();

    await expect(
      createDrive(fakeAuth()).keepRevision({ id: "file-1" }, "../../about"),
    ).rejects.toMatchObject({ name: "DriveError", status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports Drive's refusal", async () => {
    respond(refusal(400, "Too many revisions are kept forever."));

    await expect(
      createDrive(fakeAuth()).keepRevision({ id: "file-1" }, "revision-1"),
    ).rejects.toMatchObject({ name: "DriveError", status: 400 });
  });
});

describe("markViewed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the file as viewed now, which Recent sorts by", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    respond(Response.json({ id: "file-1" }));

    await createDrive(fakeAuth()).markViewed({
      id: "file-1",
      resourceKey: "key-1",
    });
    const { url, headers, init } = sent();
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: "id",
      supportsAllDrives: "true",
    });
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
    expect(sentJson()).toEqual({
      viewedByMeTime: "2026-09-28T12:00:00.000Z",
    });
  });

  it("renews a refused token and sends the same change again", async () => {
    respond(refusal(401), Response.json({ id: "file-1" }));
    const auth = fakeAuth();

    await createDrive(auth).markViewed({ id: "file-1" });
    expect(auth.forget).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(sent(1).headers.get("Authorization")).toBe(`Bearer ${NEW_TOKEN}`);
    expect(sent(1).init?.method).toBe("PATCH");
    expect(sentJson(1)).toEqual(sentJson(0));
  });

  it("reports Drive's refusal", async () => {
    respond(refusal(404, "File not found: file-1."));

    await expect(
      createDrive(fakeAuth()).markViewed({ id: "file-1" }),
    ).rejects.toMatchObject({ name: "DriveError", status: 404 });
  });
});

describe("createFile", () => {
  it("creates an empty Markdown file in the folder, in any drive", async () => {
    respond(Response.json({ ...FILE, id: "file-9", name: "Untitled.md" }));

    await expect(
      createDrive(fakeAuth()).createFile(
        { id: "folder-1", resourceKey: "key-1" },
        "Untitled.md",
      ),
    ).resolves.toMatchObject({ id: "file-9", name: "Untitled.md" });
    const { url, headers, init } = sent();
    expect(init?.method).toBe("POST");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: ITEM_FIELDS,
      supportsAllDrives: "true",
    });
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("folder-1/key-1");
    expect(sentJson()).toEqual({
      name: "Untitled.md",
      parents: ["folder-1"],
      mimeType: "text/markdown",
    });
  });

  it.each([
    [" Untitled ", "Untitled.md"],
    ["plan.markdown", "plan.markdown"],
  ])("adds .md to a name without it: %j", async (name, created) => {
    respond(Response.json({ ...FILE, name: created }));

    await createDrive(fakeAuth()).createFile({ id: "folder-1" }, name);
    expect(sentJson()).toMatchObject({ name: created });
  });

  it("reports Drive's refusal", async () => {
    respond(refusal(403, "The user does not have sufficient permissions."));

    await expect(
      createDrive(fakeAuth()).createFile({ id: "folder-1" }, "Untitled.md"),
    ).rejects.toMatchObject({ name: "DriveError", status: 403 });
  });

  it.each([
    [{ id: "folder-1" }, " "],
    [{ id: "folder-1', 'folder-2" }, "Untitled.md"],
  ])(
    "refuses a nameless file or an odd folder ID: %j, %j",
    async (folder, name) => {
      respond();

      await expect(
        createDrive(fakeAuth()).createFile(folder, name),
      ).rejects.toMatchObject({ name: "DriveError", status: 400 });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("renameFile", () => {
  it("renames the file, in any drive", async () => {
    respond(Response.json({ ...FILE, name: "plan.md" }));

    await expect(
      createDrive(fakeAuth()).renameFile(
        { id: "file-1", resourceKey: "key-1" },
        " plan.md ",
      ),
    ).resolves.toMatchObject({ name: "plan.md" });
    const { url, headers, init } = sent();
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: ITEM_FIELDS,
      supportsAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
    expect(sentJson()).toEqual({ name: "plan.md" });
  });

  it("refuses an empty name, without asking Drive", async () => {
    respond();

    await expect(
      createDrive(fakeAuth()).renameFile({ id: "file-1" }, ""),
    ).rejects.toMatchObject({ name: "DriveError", status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed answer", async () => {
    respond(Response.json(null));

    await expect(
      createDrive(fakeAuth()).renameFile({ id: "file-1" }, "plan.md"),
    ).rejects.toMatchObject({
      name: "DriveError",
      message: "Google Drive sent an unexpected answer",
    });
  });
});

describe("moveFile", () => {
  /** Reads the file as a listing would, then moves it to `to`. */
  async function move(to: FileRef) {
    const drive = createDrive(fakeAuth());
    const file = await drive.getMetadata({
      id: "file-1",
      resourceKey: "key-1",
    });
    return drive.moveFile(file, to);
  }

  it("moves the file out of its folder into another, in any drive", async () => {
    respond(
      Response.json({ ...FILE, resourceKey: "key-1", parents: ["folder-1"] }),
      Response.json({ ...FILE, parents: ["folder-2"] }),
    );

    await expect(
      move({ id: "folder-2", resourceKey: "key-3" }),
    ).resolves.toMatchObject({ parents: ["folder-2"] });
    const { url, headers, init } = sent(1);
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      addParents: "folder-2",
      removeParents: "folder-1",
      fields: ITEM_FIELDS,
      supportsAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe(
      "file-1/key-1,folder-2/key-3",
    );
    expect(sentJson(1)).toEqual({});
  });

  it("leaves a file already in the folder where it is", async () => {
    respond(Response.json({ ...FILE, parents: ["folder-2"] }));

    await expect(move({ id: "folder-2" })).resolves.toMatchObject({
      id: "file-1",
      parents: ["folder-2"],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [["folder-1,folder-3"], { id: "folder-2" }],
    [["folder-1"], { id: "../folder-2" }],
  ])(
    "refuses a folder ID that could change the move: %j, %j",
    async (parents, to) => {
      respond(Response.json({ ...FILE, parents }));

      await expect(move(to)).rejects.toMatchObject({
        name: "DriveError",
        status: 400,
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});

describe("trashFile", () => {
  it("moves the file to the trash, where it stays restorable", async () => {
    respond(Response.json({ id: "file-1" }));

    await createDrive(fakeAuth()).trashFile({
      id: "file-1",
      resourceKey: "key-1",
    });
    const { url, headers, init } = sent();
    expect(init?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/drive/v3/files/file-1",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: "id",
      supportsAllDrives: "true",
    });
    expect(headers.get("X-Goog-Drive-Resource-Keys")).toBe("file-1/key-1");
    expect(sentJson()).toEqual({ trashed: true });
  });

  it("reports Drive's refusal", async () => {
    respond(refusal(403, "The user does not have sufficient permissions."));

    await expect(
      createDrive(fakeAuth()).trashFile({ id: "file-1" }),
    ).rejects.toMatchObject({ name: "DriveError", status: 403 });
  });
});
