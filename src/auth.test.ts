import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GIS_URL = "https://accounts.google.com/gsi/client";
const DRIVE = "https://www.googleapis.com/auth/drive";
const INSTALL = "https://www.googleapis.com/auth/drive.install";
const TOKEN = "example-access-token";
const EMAIL = "ada@example.com";

interface TokenClientOptions {
  client_id: string;
  scope: string;
  callback: (response: unknown) => void;
  error_callback: (error: unknown) => void;
}

let options: TokenClientOptions | undefined;
const requestAccessToken = vi.fn();

function tokenClient(): TokenClientOptions {
  if (!options) throw new Error("The token client was not created");
  return options;
}

function tokenResponse(
  scope = `${DRIVE} ${INSTALL}`,
  expiresIn: unknown = "3599",
) {
  return { access_token: TOKEN, expires_in: expiresIn, scope };
}

async function importAuth() {
  vi.resetModules();
  return import("./auth.ts");
}

function gisScript(): HTMLScriptElement | null {
  return document.head.querySelector(`script[src="${GIS_URL}"]`);
}

async function loadAuth() {
  const auth = await importAuth();
  const loading = auth.loadGoogleIdentity();
  gisScript()?.dispatchEvent(new Event("load"));
  await loading;
  return auth;
}

beforeEach(() => {
  options = undefined;
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "example.apps.googleusercontent.com");
  vi.stubGlobal("google", {
    accounts: {
      oauth2: {
        initTokenClient: (clientOptions: TokenClientOptions) => {
          options = clientOptions;
          return { requestAccessToken };
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  requestAccessToken.mockReset();
  document.head.replaceChildren();
});

describe("loadGoogleIdentity", () => {
  it("loads the script once, then creates a token client for Drive", async () => {
    const auth = await importAuth();
    const loading = auth.loadGoogleIdentity();

    expect(auth.loadGoogleIdentity()).toBe(loading);
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    gisScript()?.dispatchEvent(new Event("load"));
    await loading;
    expect(tokenClient()).toMatchObject({
      client_id: "example.apps.googleusercontent.com",
      scope: `${DRIVE} ${INSTALL}`,
    });
  });

  it("fails without a client ID", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    const auth = await importAuth();

    await expect(auth.loadGoogleIdentity()).rejects.toMatchObject({
      reason: "not_configured",
    });
    expect(gisScript()).toBeNull();
  });

  it("retries on the next call after the script failed to load", async () => {
    const createPolicy = vi.fn((_name: string, rules: object) => rules);
    vi.stubGlobal("trustedTypes", { createPolicy });
    const auth = await importAuth();
    const failed = auth.loadGoogleIdentity();
    gisScript()?.dispatchEvent(new Event("error"));

    await expect(failed).rejects.toMatchObject({ reason: "unavailable" });
    expect(gisScript()).toBeNull();
    const retried = auth.loadGoogleIdentity();
    gisScript()?.dispatchEvent(new Event("load"));
    await expect(retried).resolves.toBeUndefined();
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });

  it("fails when the script defines no Google API", async () => {
    vi.stubGlobal("google", undefined);

    await expect(loadAuth()).rejects.toMatchObject({ reason: "unavailable" });
    expect(gisScript()).toBeNull();
  });

  it("fails when the page refuses the Trusted Types policy", async () => {
    vi.stubGlobal("trustedTypes", {
      createPolicy: () => {
        throw new TypeError("Policy refused");
      },
    });
    const auth = await importAuth();

    await expect(auth.loadGoogleIdentity()).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("goes through a Trusted Types policy that only accepts the GIS script", async () => {
    let rules: { createScriptURL: (url: string) => string } | undefined;
    vi.stubGlobal("trustedTypes", {
      createPolicy: (_name: string, policyRules: typeof rules) => {
        rules = policyRules;
        return policyRules;
      },
    });
    await loadAuth();

    expect(rules?.createScriptURL(GIS_URL)).toBe(GIS_URL);
    expect(() =>
      rules?.createScriptURL("https://attacker.example/x.js"),
    ).toThrow();
  });
});

describe("requestAccessToken", () => {
  it("fails until Google Identity Services has loaded", async () => {
    const auth = await importAuth();

    await expect(auth.requestAccessToken()).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("opens the account chooser within the calling gesture", async () => {
    const auth = await loadAuth();
    const request = auth.requestAccessToken();

    expect(requestAccessToken).toHaveBeenCalledWith({
      prompt: "select_account",
    });
    tokenClient().callback(tokenResponse());
    await expect(request).resolves.toBe(TOKEN);
    expect(auth.getAccessToken()).toBe(TOKEN);
  });

  it("renews for a known account without the account chooser", async () => {
    const auth = await loadAuth();
    const request = auth.requestAccessToken(EMAIL);

    expect(requestAccessToken).toHaveBeenCalledWith({
      prompt: "",
      login_hint: EMAIL,
    });
    tokenClient().callback(tokenResponse(DRIVE));
    await expect(request).resolves.toBe(TOKEN);
  });

  async function rejection(settle: () => void): Promise<unknown> {
    const auth = await loadAuth();
    const request = auth.requestAccessToken();
    settle();

    const error: unknown = await request.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(auth.AuthError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect(auth.getAccessToken()).toBeUndefined();
    return error;
  }

  it.each([
    ["no Drive scope", tokenResponse(INSTALL), "scope_denied"],
    ["an invalid lifetime", tokenResponse(DRIVE, "soon"), "failed"],
    ["a refusal", { error: "access_denied" }, "access_denied"],
    ["an admin block", { error: "admin_policy_enforced" }, "failed"],
    ["no response object", null, "failed"],
  ])("rejects a token response with %s", async (_case, response, reason) => {
    const error = await rejection(() => {
      tokenClient().callback(response);
    });
    expect(error).toMatchObject({ reason });
  });

  it.each([
    ["blocked", { type: "popup_failed_to_open" }, "popup_blocked"],
    ["closed", { type: "popup_closed" }, "popup_closed"],
    ["failing", { type: "unknown" }, "failed"],
    ["failing without details", undefined, "failed"],
  ])("rejects when the popup is %s", async (_case, popupError, reason) => {
    const error = await rejection(() => {
      tokenClient().error_callback(popupError);
    });
    expect(error).toMatchObject({ reason });
  });

  it("fails with a typed error when Google's client throws", async () => {
    requestAccessToken.mockImplementationOnce(() => {
      throw new Error("Invalid client state");
    });
    const auth = await loadAuth();

    await expect(auth.requestAccessToken()).rejects.toMatchObject({
      reason: "failed",
    });
    tokenClient().callback(tokenResponse());
    expect(auth.getAccessToken()).toBeUndefined();
  });

  it("supersedes a pending request with a newer one", async () => {
    const auth = await loadAuth();
    const first = auth.requestAccessToken();
    const second = auth.requestAccessToken();

    await expect(first).rejects.toMatchObject({ reason: "superseded" });
    tokenClient().callback(tokenResponse());
    await expect(second).resolves.toBe(TOKEN);
  });

  it("ignores a response that no request is waiting for", async () => {
    const auth = await loadAuth();
    tokenClient().callback(tokenResponse());

    expect(auth.getAccessToken()).toBeUndefined();
  });
});

describe("getAccessToken", () => {
  it("counts the token as expired 5 minutes before Google's expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 0 });
    const auth = await loadAuth();
    const request = auth.requestAccessToken();
    tokenClient().callback(tokenResponse(DRIVE, 3600));
    await request;

    vi.setSystemTime(55 * 60_000 - 1);
    expect(auth.getAccessToken()).toBe(TOKEN);
    vi.setSystemTime(55 * 60_000);
    expect(auth.getAccessToken()).toBeUndefined();
  });
});
