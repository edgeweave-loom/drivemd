// @vitest-environment node
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codeFrom,
  configDir,
  finishLogin,
  liveSession,
  readClient,
  readGrant,
  REDIRECT_URI,
  saveGrant,
  signIn,
  startLogin,
} from "./grant.ts";

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
    await saveGrant(dir, GRANT);

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

describe("saveGrant", () => {
  it("keeps the grant readable only by the user, replacing an older one", async () => {
    await saveGrant(dir, { account: ACCOUNT, refreshToken: "older" });
    await saveGrant(dir, GRANT);

    await expect(readGrant(dir)).resolves.toEqual(GRANT);
    expect((await stat(join(dir, "grant.json"))).mode & 0o777).toBe(0o600);
  });

  it("replaces a draft that a failed save left, without writing through it", async () => {
    await writeFile(join(dir, "elsewhere"), "untouched");
    await symlink(join(dir, "elsewhere"), join(dir, "grant.json.draft"));

    await saveGrant(dir, GRANT);
    await expect(readGrant(dir)).resolves.toEqual(GRANT);
    await expect(readFile(join(dir, "elsewhere"), "utf8")).resolves.toBe(
      "untouched",
    );
  });
});

describe("startLogin", () => {
  it("asks for lasting access to the test account's Drive, with PKCE", () => {
    const { url, pending } = startLogin(CLIENT, ACCOUNT);

    const address = new URL(url);
    expect(address.origin + address.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(address.searchParams)).toEqual({
      client_id: CLIENT.id,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive",
      access_type: "offline",
      prompt: "consent select_account",
      login_hint: ACCOUNT,
      state: pending.state,
      code_challenge: createHash("sha256")
        .update(pending.verifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(pending.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("makes new secrets for each sign-in", () => {
    const first = startLogin(CLIENT, ACCOUNT).pending;
    const second = startLogin(CLIENT, ACCOUNT).pending;

    expect(second.state).not.toBe(first.state);
    expect(second.verifier).not.toBe(first.verifier);
  });
});

describe("codeFrom", () => {
  const pending = { verifier: "example-verifier", state: "example-state" };

  it("reads the code from the address the browser was sent back to", () => {
    const address = ` ${REDIRECT_URI}?state=example-state&code=example-code `;

    expect(codeFrom(address, pending)).toBe("example-code");
  });

  it.each([
    [`${REDIRECT_URI}?state=other&code=example-code`, "another sign-in"],
    [
      `${REDIRECT_URI}?state=example-state&error=access_denied`,
      "access_denied",
    ],
    [`${REDIRECT_URI}?state=example-state`, "no code"],
    [
      "https://accounts.google.com/signin?state=example-state&code=example-code",
      "not the address",
    ],
    ["not an address", "Invalid URL"],
  ])("refuses %s", (address, message) => {
    expect(() => codeFrom(address, pending)).toThrow(message);
  });
});

describe("finishLogin", () => {
  const pending = { verifier: "example-verifier", state: "example-state" };

  function tokens(refreshToken?: string, accessToken?: string): Response {
    return Response.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3599,
    });
  }

  it("trades the code for a grant, once the test account is the one signed in", async () => {
    respond(
      tokens(GRANT.refreshToken, "example-access-token"),
      Response.json({ user: { emailAddress: ACCOUNT } }),
    );

    await expect(
      finishLogin(CLIENT, " Test.User@Example.com ", "example-code", pending),
    ).resolves.toEqual(GRANT);
    expect(sent(0).url).toBe("https://oauth2.googleapis.com/token");
    expect(sent(0).init?.method).toBe("POST");
    expect(sent(0).form).toEqual({
      grant_type: "authorization_code",
      code: "example-code",
      code_verifier: "example-verifier",
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT.id,
      client_secret: CLIENT.secret,
    });
    expect(sent(1).url).toContain("/drive/v3/about");
  });

  it.each([
    [
      "another account signed in",
      Response.json({ user: { emailAddress: "someone@example.com" } }),
      "Google signed in someone@example.com, not test.user@example.com",
    ],
    [
      "Drive cannot tell who signed in",
      Response.json({ error: { message: "Forbidden" } }, { status: 403 }),
      "Drive could not tell who signed in",
    ],
  ])("revokes the grant when %s", async (_, answer, message) => {
    respond(
      tokens(GRANT.refreshToken, "example-access-token"),
      answer,
      new Response(null, { status: 200 }),
    );

    await expect(
      finishLogin(CLIENT, ACCOUNT, "example-code", pending),
    ).rejects.toThrow(`${message}: the grant was revoked`);
    expect(sent(2).url).toBe("https://oauth2.googleapis.com/revoke");
    expect(sent(2).form).toEqual({ token: GRANT.refreshToken });
  });

  it("revokes a grant that comes without an access token", async () => {
    respond(tokens(GRANT.refreshToken), new Response(null, { status: 200 }));

    await expect(
      finishLogin(CLIENT, ACCOUNT, "example-code", pending),
    ).rejects.toThrow("no access token: the grant was revoked");
  });

  it.each([
    ["refuses", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["cannot be reached", () => Promise.reject(new TypeError("offline"))],
  ])(
    "says what to do when Google %s to revoke the grant",
    async (_, revoke) => {
      respond(
        tokens(GRANT.refreshToken, "example-access-token"),
        Response.json({ user: { emailAddress: "someone@example.com" } }),
      );
      vi.mocked(fetch).mockImplementationOnce(revoke);

      await expect(
        finishLogin(CLIENT, ACCOUNT, "example-code", pending),
      ).rejects.toThrow("myaccount.google.com/connections");
    },
  );

  it("reports Google's refusal without quoting the request", async () => {
    respond(Response.json({ error: "invalid_grant" }, { status: 400 }));

    await expect(
      finishLogin(CLIENT, ACCOUNT, "example-code", pending),
    ).rejects.toThrow(/^Google refused: invalid_grant$/);
  });

  it("refuses an answer without a refresh token", async () => {
    respond(tokens(undefined, "example-access-token"));

    await expect(
      finishLogin(CLIENT, ACCOUNT, "example-code", pending),
    ).rejects.toThrow("no lasting grant");
  });
});

describe("signIn", () => {
  /** A terminal where the user pastes what Google sent the browser back to. */
  function terminal() {
    const shown: string[] = [];
    return {
      shown,
      prompt: {
        show(text: string) {
          shown.push(text);
        },
        ask() {
          const url = /https:\/\/accounts\S+/.exec(shown.join(""))?.[0] ?? "";
          const state = new URL(url).searchParams.get("state") ?? "";
          return Promise.resolve(
            `${REDIRECT_URI}?state=${state}&code=example-code`,
          );
        },
      },
    };
  }

  function signedIn(refreshToken: string, ...more: Response[]) {
    respond(
      Response.json({
        access_token: "example-access-token",
        refresh_token: refreshToken,
      }),
      Response.json({ user: { emailAddress: ACCOUNT } }),
      ...more,
    );
  }

  it.each([undefined, " "])(
    "needs the test account's address: %j",
    async (account) => {
      respond();

      await expect(signIn(dir, account, terminal().prompt)).rejects.toThrow(
        "DRIVEMD_LIVE_ACCOUNT",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("needs the desktop client", async () => {
    await expect(signIn(dir, ACCOUNT, terminal().prompt)).rejects.toThrow(
      "Save the desktop OAuth client",
    );
  });

  it("saves the grant of the test account, and revokes the one it replaces", async () => {
    await placeClient();
    await place("grant.json", { account: ACCOUNT, refreshToken: "older" });
    signedIn("newer", new Response(null, { status: 200 }));
    const { shown, prompt } = terminal();

    await signIn(dir, ACCOUNT, prompt);
    await expect(readGrant(dir)).resolves.toEqual({
      account: ACCOUNT,
      refreshToken: "newer",
    });
    expect(sent(2).form).toEqual({ token: "older" });
    expect(shown.join("")).toContain(`Saved the grant for ${ACCOUNT}`);
  });

  it("keeps a grant Google hands out again", async () => {
    await placeClient();
    await place("grant.json", GRANT);
    signedIn(GRANT.refreshToken);

    await signIn(dir, ACCOUNT, terminal().prompt);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("says so when the grant it replaces could not be revoked", async () => {
    await placeClient();
    await place("grant.json", { account: ACCOUNT, refreshToken: "older" });
    signedIn("newer", new Response(null, { status: 503 }));
    const { shown, prompt } = terminal();

    await signIn(dir, ACCOUNT, prompt);
    expect(shown.join("")).toContain("could not be revoked");
  });

  it("revokes the new grant when it cannot save it", async () => {
    await placeClient();
    await mkdir(join(dir, "grant.json", "in-the-way"), { recursive: true });
    signedIn("newer", new Response(null, { status: 200 }));

    await expect(signIn(dir, ACCOUNT, terminal().prompt)).rejects.toThrow();
    expect(sent(2).form).toEqual({ token: "newer" });
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

  it("accepts the account's address whatever its case", async () => {
    respond(minted("token-1"), owner("Test.User@Example.com"));

    await expect(session()).resolves.toMatchObject({ account: ACCOUNT });
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
