// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configDir, liveSession, readClient, readGrant } from "./grant.ts";

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, userInfo: vi.fn(os.userInfo) };
});

const CLIENT = {
  id: "example-client.apps.googleusercontent.com",
  secret: "example-client-secret",
};
const ACCOUNT = "test.user@example.com";
const GRANT = { account: ACCOUNT, refreshToken: "example-refresh-token" };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drivemd-live-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

/** Writes a JSON file in the test folder, with the given mode. */
async function place(name: string, value: unknown, mode = 0o600) {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(value));
  await chmod(path, mode);
}

function placeClient(mode?: number) {
  return place(
    "client.json",
    {
      installed: {
        client_id: CLIENT.id,
        client_secret: CLIENT.secret,
        redirect_uris: ["http://localhost"],
      },
    },
    mode,
  );
}

/** Answers each request with the next response, in order. */
function respond(...responses: Response[]): void {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
}

/** The URL and form fields of a request. */
function sent(call = 0) {
  const [url, init] = vi.mocked(fetch).mock.calls[call] ?? [];
  if (typeof url !== "string") throw new Error(`No call #${String(call)}`);
  const form = init?.body instanceof URLSearchParams ? init.body : undefined;
  return { url, init, form: Object.fromEntries(form ?? []) };
}

describe("configDir", () => {
  it("keeps the grant in the user's config folder, outside the repository", () => {
    vi.stubEnv("DRIVEMD_LIVE_DIR", undefined);

    expect(configDir()).toBe(join(homedir(), ".config", "drivemd-live"));
  });

  it("takes another folder from DRIVEMD_LIVE_DIR", () => {
    vi.stubEnv("DRIVEMD_LIVE_DIR", "/elsewhere");

    expect(configDir()).toBe("/elsewhere");
  });

  it("ignores an empty DRIVEMD_LIVE_DIR", () => {
    vi.stubEnv("DRIVEMD_LIVE_DIR", "");

    expect(configDir()).toBe(join(homedir(), ".config", "drivemd-live"));
  });

  it("refuses a relative folder, which could lie in the repository", () => {
    vi.stubEnv("DRIVEMD_LIVE_DIR", "live");

    expect(() => configDir()).toThrow("absolute");
  });
});

describe("the client and the grant", () => {
  it("are missing until the files are there", async () => {
    await expect(readClient(dir)).resolves.toBeUndefined();
    await expect(readGrant(dir)).resolves.toBeUndefined();
  });

  it("are read from the desktop client Google gave and the saved grant", async () => {
    await placeClient();
    await place("grant.json", GRANT);

    await expect(readClient(dir)).resolves.toEqual(CLIENT);
    await expect(readGrant(dir)).resolves.toEqual(GRANT);
  });

  it("are refused when others can read them", async () => {
    await placeClient(0o644);
    await place("grant.json", GRANT, 0o640);

    await expect(readClient(dir)).rejects.toThrow("chmod 600");
    await expect(readGrant(dir)).rejects.toThrow("chmod 600");
  });

  it.each([
    { web: { client_id: CLIENT.id, client_secret: CLIENT.secret } },
    { installed: { client_id: CLIENT.id } },
    null,
  ])("refuse a client that is not a desktop client: %j", async (client) => {
    await place("client.json", client);

    await expect(readClient(dir)).rejects.toThrow("desktop OAuth client");
  });

  it("are refused when they belong to another user", async () => {
    await placeClient();
    vi.mocked(userInfo).mockReturnValueOnce({ ...userInfo(), uid: 12345 });

    await expect(readClient(dir)).rejects.toThrow("another user");
  });

  it("are refused without quoting them when they are not JSON", async () => {
    const path = join(dir, "grant.json");
    await writeFile(path, '{"refreshToken": secret-value}');
    await chmod(path, 0o600);

    await expect(readGrant(dir)).rejects.toThrow(
      new RegExp(`^${path} is not valid JSON$`),
    );
  });

  it("report a folder they cannot be read from", async () => {
    await writeFile(join(dir, "a-file"), "");

    await expect(readClient(join(dir, "a-file"))).rejects.toThrow("ENOTDIR");
  });

  it("refuse a malformed grant", async () => {
    await place("grant.json", { account: ACCOUNT });

    await expect(readGrant(dir)).rejects.toThrow("grant");
  });
});

describe("liveSession", () => {
  function minted(accessToken: string): Response {
    return Response.json({ access_token: accessToken, expires_in: 3600 });
  }

  /** Drive's answer to who owns the token. */
  function owner(email = ACCOUNT): Response {
    return Response.json({ user: { emailAddress: email } });
  }

  async function session() {
    await placeClient();
    await place("grant.json", GRANT);
    const live = await liveSession(dir);
    if (!live) throw new Error("No session");
    return live;
  }

  it("is missing without a client and a grant", async () => {
    await placeClient();

    await expect(liveSession(dir)).resolves.toBeUndefined();
  });

  it("mints a token, checks it is the account's, and reuses it while it is fresh", async () => {
    respond(minted("token-1"), owner());
    const { account, auth } = await session();

    expect(account).toBe(ACCOUNT);
    await expect(auth.token()).resolves.toBe("token-1");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sent(0).url).toBe("https://oauth2.googleapis.com/token");
    expect(sent(0).form).toEqual({
      grant_type: "refresh_token",
      refresh_token: GRANT.refreshToken,
      client_id: CLIENT.id,
      client_secret: CLIENT.secret,
    });
    expect(sent(0).init?.signal).toBeInstanceOf(AbortSignal);
    expect(sent(1).url).toContain("/drive/v3/about");
    expect(new Headers(sent(1).init?.headers).get("Authorization")).toBe(
      "Bearer token-1",
    );
  });

  it("refuses a grant that belongs to another account", async () => {
    respond(minted("token-1"), owner("someone@example.com"));

    await expect(session()).rejects.toThrow(
      `belongs to someone@example.com, not ${ACCOUNT}`,
    );
  });

  it("mints a new token once the last one is about to expire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    respond(minted("token-1"), owner(), minted("token-2"));
    const { auth } = await session();

    vi.setSystemTime(Date.now() + 3570_000);
    await expect(auth.token()).resolves.toBe("token-2");
  });

  it("forgets only the token Drive refused", async () => {
    respond(minted("token-1"), owner(), minted("token-2"));
    const { auth } = await session();

    auth.forget("older-token");
    await expect(auth.token()).resolves.toBe("token-1");
    auth.forget("token-1");
    await expect(auth.token()).resolves.toBe("token-2");
  });

  it("mints one token for callers asking at once", async () => {
    respond(minted("token-1"), owner(), minted("token-2"));
    const { auth } = await session();

    auth.forget("token-1");
    await expect(Promise.all([auth.token(), auth.token()])).resolves.toEqual([
      "token-2",
      "token-2",
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    { access_token: "token-1" },
    { access_token: "token-1", expires_in: 0 },
    { access_token: "token-1", expires_in: -1 },
  ])("refuses a token without a lifetime ahead: %j", async (body) => {
    respond(Response.json(body));

    await expect(session()).rejects.toThrow("malformed token");
  });

  it("reports an answer that is not JSON by its status", async () => {
    respond(new Response("Bad Gateway", { status: 502 }));

    await expect(session()).rejects.toThrow("Google refused: 502");
  });

  it("reports a grant Google no longer accepts, without quoting it", async () => {
    respond(Response.json({ error: "invalid_grant" }, { status: 400 }));

    await expect(session()).rejects.toThrow(/^Google refused: invalid_grant$/);
  });
});
