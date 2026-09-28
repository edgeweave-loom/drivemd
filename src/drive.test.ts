import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDrive,
  DriveError,
  getAccountEmail,
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
    expect(url.searchParams.get("fields")).toBe(
      "id,name,mimeType,resourceKey,parents,driveId," +
        "capabilities(canAddChildren,canComment,canDownload,canEdit," +
        "canModifyContent,canMoveItemOutOfDrive,canMoveItemWithinDrive," +
        "canRename,canTrash),contentRestrictions(readOnly,reason)," +
        "modifiedTime,lastModifyingUser(displayName),md5Checksum,headRevisionId",
    );
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

const ITEM_FIELDS =
  "id,name,mimeType,resourceKey,parents,driveId," +
  "capabilities(canAddChildren,canComment,canDownload,canEdit," +
  "canModifyContent,canMoveItemOutOfDrive,canMoveItemWithinDrive," +
  "canRename,canTrash),contentRestrictions(readOnly,reason)";

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

  it.each([{ files: [FILE, { ...FILE, id: 7 }] }, { files: [null] }, null])(
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
  it("lists every shared drive the user is a member of", async () => {
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
      fields: "nextPageToken,drives(id,name)",
      pageSize: "100",
    });
    expect(sent(1).url.searchParams.get("pageToken")).toBe("page-2");
  });

  it.each([
    { drives: [{ id: "drive-1" }] },
    { drives: [{ id: 1, name: "Team" }] },
  ])("rejects a malformed drive: %j", async (body) => {
    respond(Response.json(body));

    await expect(
      createDrive(fakeAuth()).listSharedDrives(),
    ).rejects.toMatchObject({ name: "DriveError", status: 200 });
  });
});
