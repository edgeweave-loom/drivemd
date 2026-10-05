import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "./auth.ts";
import { AuthError, type AuthErrorReason } from "./auth.ts";
import {
  createDrive,
  DriveError,
  getAccountEmail,
  type Drive,
  type DriveAuth,
} from "./drive.ts";
import { createSession, type Session } from "./session.ts";

vi.mock("./auth.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.ts")>()),
  loadGoogleIdentity: vi.fn(),
  requestAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
  clearToken: vi.fn(),
  getRememberedAccount: vi.fn(),
  rememberAccount: vi.fn(),
  signOut: vi.fn(),
  onSignOutElsewhere: vi.fn(),
}));

vi.mock("./drive.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drive.ts")>()),
  getAccountEmail: vi.fn(),
  createDrive: vi.fn(),
}));

const TOKEN = "example-access-token";
const NEW_TOKEN = "example-renewed-token";
const EMAIL = "ada@example.com";

interface PendingToken {
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

function pendingToken(): PendingToken {
  const pending: Partial<PendingToken> = {};
  pending.promise = new Promise((resolve, reject) => {
    Object.assign(pending, { resolve, reject });
  });
  return pending as PendingToken;
}

function screenOf(session: Session) {
  return session.getSnapshot().screen;
}

async function settled(session: Session) {
  await vi.waitFor(() => {
    expect(session.getSnapshot().waiting).toBe(false);
  });
}

async function signedIn() {
  vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
  vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
  const session = createSession();
  await settled(session);
  return session;
}

/** How the session's Drive client gets its tokens. */
function driveAuth(): DriveAuth {
  const [given] = vi.mocked(createDrive).mock.lastCall ?? [];
  if (!given) throw new Error("The session made no Drive client");
  return given;
}

/** Whether a promise has settled, after pending callbacks have run. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve));
  return done;
}

function onSignOutElsewhere() {
  const [[listener]] = vi.mocked(auth.onSignOutElsewhere).mock.calls as [
    [() => void],
  ];
  listener();
}

function violate(details: Record<string, string>) {
  document.dispatchEvent(
    Object.assign(new Event("securitypolicyviolation"), details),
  );
}

beforeEach(() => {
  vi.mocked(auth.loadGoogleIdentity).mockResolvedValue();
  vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
  vi.mocked(auth.getRememberedAccount).mockReturnValue(undefined);
  vi.mocked(getAccountEmail).mockResolvedValue(EMAIL);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("on start", () => {
  it("shows Sign in, enabled once Google's script has loaded", async () => {
    const session = createSession();

    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "sign-in" },
      google: "loading",
    });
    await vi.waitFor(() => {
      expect(session.getSnapshot().google).toBe("ready");
    });
  });

  it("offers Continue for the account remembered on the device", () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);

    expect(screenOf(createSession())).toEqual({
      name: "continue",
      email: EMAIL,
    });
  });

  it("reopens this tab's session for the account remembered on the device", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    const session = createSession();

    expect(screenOf(session)).toEqual({ name: "loading", email: EMAIL });
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    expect(getAccountEmail).toHaveBeenCalledWith(TOKEN);
  });

  it("drops a stored token that belongs to another account", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue("grace@example.com");
    const session = createSession();

    await settled(session);
    expect(auth.clearToken).toHaveBeenCalled();
    expect(auth.rememberAccount).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "continue", email: "grace@example.com" },
      message: expect.stringMatching(/another account/) as unknown,
    });
  });

  it("asks to Continue when Drive rejects the stored token", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(getAccountEmail).mockRejectedValue(
      new DriveError(401, "Invalid"),
    );
    const session = createSession();

    await settled(session);
    expect(screenOf(session)).toEqual({ name: "continue", email: EMAIL });
    expect(auth.clearToken).toHaveBeenCalled();
    expect(session.getSnapshot().message).toBeUndefined();
  });

  it("reports a missing client ID as a setup problem, not a failure to retry", async () => {
    vi.mocked(auth.loadGoogleIdentity).mockRejectedValueOnce(
      new AuthError("not_configured", "VITE_GOOGLE_CLIENT_ID is not set"),
    );
    const session = createSession();

    await vi.waitFor(() => {
      expect(session.getSnapshot().google).toBe("unconfigured");
    });
    expect(session.getSnapshot().message).toMatch(/not configured/);
  });

  it("explains a failed load of Google's script and retries it", async () => {
    vi.mocked(auth.loadGoogleIdentity).mockRejectedValueOnce(
      new AuthError("unavailable", "The GIS script failed to load"),
    );
    const session = createSession();
    await vi.waitFor(() => {
      expect(session.getSnapshot().google).toBe("failed");
    });
    expect(session.getSnapshot().message).toMatch(/could not load/);

    session.retry();
    await vi.waitFor(() => {
      expect(session.getSnapshot()).toMatchObject({
        google: "ready",
        message: undefined,
      });
    });
  });
});

describe("the store", () => {
  it("notifies subscribers of each change until they unsubscribe", () => {
    const session = createSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.signOut();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    session.signOut();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("signing in", () => {
  it("opens the account chooser within the tap, then shows the Drive email", async () => {
    const request = pendingToken();
    vi.mocked(auth.requestAccessToken).mockReturnValue(request.promise);
    const session = createSession();

    session.signIn();
    expect(auth.requestAccessToken).toHaveBeenCalledWith();
    expect(session.getSnapshot().waiting).toBe(true);
    request.resolve(TOKEN);
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    expect(auth.rememberAccount).toHaveBeenCalledWith(EMAIL);
  });

  it.each<[AuthErrorReason, RegExp]>([
    ["popup_blocked", /blocked/],
    ["access_denied", /declined/],
    ["scope_denied", /needs access/],
    ["failed", /failed/],
  ])("explains a %s failure and stays on Sign in", async (reason, message) => {
    vi.mocked(auth.requestAccessToken).mockRejectedValue(
      new AuthError(reason, "details"),
    );
    const session = createSession();

    session.signIn();
    await settled(session);
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "sign-in" },
      message: expect.stringMatching(message) as unknown,
    });
  });

  it("explains an unexpected failure", async () => {
    vi.mocked(auth.requestAccessToken).mockRejectedValue(new Error("boom"));
    const session = createSession();

    session.signIn();
    await settled(session);
    expect(session.getSnapshot().message).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("clears an earlier message once signed in", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(auth.loadGoogleIdentity).mockRejectedValueOnce(
      new AuthError("unavailable", "The GIS script failed to load"),
    );
    const session = createSession();

    await settled(session);
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "home", email: EMAIL },
      message: undefined,
    });
  });

  it.each([
    [
      new DriveError(403, "Drive API is disabled"),
      "Google Drive refused the request: Drive API is disabled",
    ],
    [
      new DriveError(0, "Google Drive could not be reached"),
      "Google Drive could not be reached. Check your connection.",
    ],
    [
      new DriveError(200, "Google Drive sent an unexpected answer"),
      "Google Drive sent an unexpected answer",
    ],
  ])("explains Drive's answer after sign-in: %s", async (error, message) => {
    vi.mocked(auth.requestAccessToken).mockResolvedValue(TOKEN);
    vi.mocked(getAccountEmail).mockRejectedValue(error);
    const session = createSession();

    session.signIn();
    await settled(session);
    expect(session.getSnapshot().message).toBe(message);
  });
});

describe("a tab that Drive opened", () => {
  // Drive's Open with and New name the account by its Google profile ID.
  const DRIVE_ACCOUNT = "104857600000000000001";
  const CHOOSE = { choose: true };

  it("signs in afresh, the user picking the account from Drive's", async () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue("grace@example.com");
    vi.mocked(auth.requestAccessToken).mockResolvedValue(TOKEN);
    const session = createSession(DRIVE_ACCOUNT);
    expect(screenOf(session)).toEqual({ name: "sign-in" });

    session.signIn();
    expect(auth.requestAccessToken).toHaveBeenCalledWith(DRIVE_ACCOUNT, CHOOSE);
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    expect(auth.rememberAccount).toHaveBeenCalledWith(EMAIL);
  });

  it("acts as its own account when it already has a token", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    const session = createSession(DRIVE_ACCOUNT);

    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    expect(auth.requestAccessToken).not.toHaveBeenCalled();
  });

  it("asks for Drive's account until the tab has signed in, then for its own", async () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(auth.requestAccessToken)
      .mockRejectedValueOnce(new AuthError("popup_blocked", "details"))
      .mockResolvedValue(TOKEN);
    const session = createSession(DRIVE_ACCOUNT);
    session.signIn();
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "sign-in" });

    session.signIn();
    expect(auth.requestAccessToken).toHaveBeenLastCalledWith(
      DRIVE_ACCOUNT,
      CHOOSE,
    );
    await settled(session);
    onSignOutElsewhere();
    expect(screenOf(session)).toEqual({ name: "continue", email: EMAIL });
  });

  it("forgets Drive's account once the user signs out", () => {
    vi.mocked(auth.requestAccessToken).mockReturnValue(
      new Promise(() => undefined),
    );
    const session = createSession(DRIVE_ACCOUNT);

    session.signOut();
    session.signIn();
    expect(auth.requestAccessToken).toHaveBeenCalledWith();
  });
});

describe("continuing", () => {
  it("renews the token for the remembered account within the tap", async () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(TOKEN);
    const session = createSession();

    session.continueSession();
    expect(auth.requestAccessToken).toHaveBeenCalledWith(EMAIL);
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
  });

  it("keeps the token when Drive is unreachable, then continues without a popup", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(getAccountEmail).mockRejectedValueOnce(
      new DriveError(0, "Google Drive could not be reached"),
    );
    const session = createSession();
    await settled(session);
    expect(session.getSnapshot().message).toMatch(/could not be reached/);
    expect(auth.clearToken).not.toHaveBeenCalled();

    session.continueSession();
    await settled(session);
    expect(auth.requestAccessToken).not.toHaveBeenCalled();
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
  });

  it("drops a reused token that belongs to another account", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(getAccountEmail)
      .mockRejectedValueOnce(
        new DriveError(0, "Google Drive could not be reached"),
      )
      .mockResolvedValueOnce("grace@example.com");
    const session = createSession();
    await settled(session);

    session.continueSession();
    await settled(session);
    expect(auth.clearToken).toHaveBeenCalled();
    expect(auth.rememberAccount).not.toHaveBeenCalled();
    expect(screenOf(session)).toEqual({ name: "continue", email: EMAIL });
  });

  it("does nothing outside the Continue screen", () => {
    const session = createSession();
    session.continueSession();

    expect(auth.requestAccessToken).not.toHaveBeenCalled();
    expect(session.getSnapshot().waiting).toBe(false);
  });
});

describe("signing out", () => {
  it.each([
    [
      "succeeds",
      (request: PendingToken) => {
        request.resolve(TOKEN);
      },
    ],
    [
      "fails",
      (request: PendingToken) => {
        request.reject(new AuthError("superseded", "The user signed out"));
      },
    ],
  ])(
    "stays signed out when a pending sign-in %s late",
    async (_case, settle) => {
      const request = pendingToken();
      vi.mocked(auth.requestAccessToken).mockReturnValue(request.promise);
      const session = createSession();
      session.signIn();
      session.signOut();
      settle(request);
      await new Promise((resolve) => setTimeout(resolve));

      expect(auth.signOut).toHaveBeenCalled();
      expect(session.getSnapshot()).toMatchObject({
        screen: { name: "sign-in" },
        waiting: false,
        message: "You're signed out.",
      });
      expect(auth.rememberAccount).not.toHaveBeenCalled();
    },
  );

  it("follows a sign-out in another tab", async () => {
    const session = await signedIn();
    vi.mocked(auth.getRememberedAccount).mockReturnValue(undefined);
    onSignOutElsewhere();

    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "sign-in" },
      message: "This tab was signed out from another tab.",
    });
  });

  it("ignores a sign-out elsewhere while idle on Sign in", () => {
    const session = createSession();
    onSignOutElsewhere();

    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "sign-in" },
      message: undefined,
    });
  });
});

describe("while the app is open", () => {
  it.each(["visibilitychange", "pageshow"])(
    "asks to Continue on %s once the token has expired",
    async (event) => {
      const session = await signedIn();
      vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
      (event === "pageshow" ? window : document).dispatchEvent(
        new Event(event),
      );

      expect(screenOf(session)).toEqual({ name: "continue", email: EMAIL });
    },
  );

  it("signs this tab out on return when the device signed out meanwhile", async () => {
    const session = await signedIn();
    vi.mocked(auth.getRememberedAccount).mockReturnValue(undefined);
    window.dispatchEvent(new Event("pageshow"));

    expect(auth.clearToken).toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "sign-in" },
      message: "This tab was signed out from another tab.",
    });
  });

  it("keeps the session while the token is valid or the page is hidden", async () => {
    const session = await signedIn();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
  });

  it.each([
    [
      "https://accounts.google.com/gsi/client?v=1",
      "script-src-elem",
      "https://accounts.google.com",
    ],
    [
      "https://www.googleapis.com/drive/v3/about",
      "connect-src",
      "https://www.googleapis.com",
    ],
    ["trusted-types-sink", "require-trusted-types-for", "trusted-types-sink"],
  ])(
    "shows that the security policy blocked %s",
    (blockedURI, directive, shown) => {
      const session = createSession();
      violate({ blockedURI, effectiveDirective: directive });

      expect(session.getSnapshot().blocked).toBe(
        `The browser's security policy blocked ${shown} (${directive}).`,
      );
    },
  );

  it("forgets what was blocked once Google's script loads again or sign-in works", async () => {
    vi.mocked(auth.loadGoogleIdentity).mockRejectedValueOnce(
      new AuthError("unavailable", "The GIS script failed to load"),
    );
    const session = createSession();
    violate({
      blockedURI: "https://accounts.google.com/gsi/client",
      effectiveDirective: "script-src-elem",
    });
    await vi.waitFor(() => {
      expect(session.getSnapshot().google).toBe("failed");
    });

    session.retry();
    expect(session.getSnapshot().blocked).toBeUndefined();
    violate({
      blockedURI: "trusted-types-sink",
      effectiveDirective: "require-trusted-types-for",
    });
    vi.mocked(auth.requestAccessToken).mockResolvedValue(TOKEN);
    session.signIn();
    await settled(session);
    expect(session.getSnapshot().blocked).toBeUndefined();
  });

  it.each([
    { blockedURI: "inline", effectiveDirective: "style-src-elem" },
    {
      blockedURI: "https://accounts.google.com/gsi/style",
      effectiveDirective: "style-src-elem",
    },
    {
      blockedURI: "https://extension.example/x.js",
      effectiveDirective: "script-src-elem",
    },
    {
      blockedURI: "https://accounts.google.com/gsi/client",
      effectiveDirective: "script-src-elem",
      disposition: "report",
    },
  ])("ignores a violation that sign-in does not depend on: %o", (violation) => {
    const session = createSession();
    violate(violation);

    expect(session.getSnapshot().blocked).toBeUndefined();
  });
});

describe("the Drive client", () => {
  it("belongs to the session and takes the tab's token", async () => {
    const drive = {} as Drive;
    vi.mocked(createDrive).mockReturnValue(drive);
    const session = await signedIn();

    expect(session.drive).toBe(drive);
    await expect(driveAuth().token()).resolves.toBe(TOKEN);
  });

  it("asks to Continue when no tap is renewing the token, then gets the new one", async () => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(NEW_TOKEN);

    const token = driveAuth().token();
    expect(screenOf(session)).toEqual({ name: "continue", email: EMAIL });
    session.continueSession();
    await expect(token).resolves.toBe(NEW_TOKEN);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
  });

  it("waits on the Continue screen without asking again", async () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(NEW_TOKEN);
    const session = createSession();
    const listener = vi.fn();
    session.subscribe(listener);

    const token = driveAuth().token();
    expect(listener).not.toHaveBeenCalled();
    session.continueSession();
    await expect(token).resolves.toBe(NEW_TOKEN);
  });

  it("renews an expired token within the tap, and Drive waits for its check", async () => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    const request = pendingToken();
    vi.mocked(auth.requestAccessToken).mockReturnValue(request.promise);

    session.renew();
    expect(auth.requestAccessToken).toHaveBeenCalledWith(EMAIL);
    // Google's answer is the tab's token before Drive says whose it is.
    vi.mocked(auth.getAccessToken).mockReturnValue(NEW_TOKEN);
    const token = driveAuth().token();
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "home", email: EMAIL },
      waiting: true,
    });
    expect(await hasSettled(token)).toBe(false);
    request.resolve(NEW_TOKEN);
    await expect(token).resolves.toBe(NEW_TOKEN);
    expect(getAccountEmail).toHaveBeenLastCalledWith(NEW_TOKEN);
  });

  it("waits for the reopened session's token to be checked", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    const check = pendingToken();
    vi.mocked(getAccountEmail).mockReturnValue(check.promise);
    createSession();

    const token = driveAuth().token();
    expect(await hasSettled(token)).toBe(false);
    check.resolve(EMAIL);
    await expect(token).resolves.toBe(TOKEN);
  });

  it("renews nothing while the token is valid", async () => {
    const session = await signedIn();
    session.renew();

    expect(auth.requestAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ["Sign in", undefined],
    ["Continue", EMAIL],
  ])("renews nothing on the %s screen", (_screen, remembered) => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(remembered);
    createSession().renew();

    expect(auth.requestAccessToken).not.toHaveBeenCalled();
  });

  it("asks to Continue when the renewal fails, and Drive keeps waiting", async () => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    vi.mocked(auth.requestAccessToken)
      .mockRejectedValueOnce(new AuthError("popup_blocked", "details"))
      .mockResolvedValueOnce(NEW_TOKEN);

    session.renew();
    const token = driveAuth().token();
    await settled(session);
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "continue", email: EMAIL },
      message: expect.stringMatching(/blocked/) as unknown,
    });
    expect(await hasSettled(token)).toBe(false);
    session.continueSession();
    await expect(token).resolves.toBe(NEW_TOKEN);
  });

  it("keeps Drive waiting when a renewal brings another account", async () => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(NEW_TOKEN);
    vi.mocked(getAccountEmail).mockResolvedValueOnce("grace@example.com");

    session.renew();
    const token = driveAuth().token();
    await settled(session);
    expect(session.getSnapshot()).toMatchObject({
      screen: { name: "continue", email: EMAIL },
      message: expect.stringMatching(/another account/) as unknown,
    });
    expect(await hasSettled(token)).toBe(false);
    session.continueSession();
    await expect(token).resolves.toBe(NEW_TOKEN);
  });

  it("keeps Drive waiting through a failed check, then fails it when another account signs in", async () => {
    vi.mocked(auth.getRememberedAccount).mockReturnValue(EMAIL);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(NEW_TOKEN);
    vi.mocked(getAccountEmail)
      .mockRejectedValueOnce(
        new DriveError(0, "Google Drive could not be reached"),
      )
      .mockResolvedValueOnce("grace@example.com");
    const session = createSession();
    const token = driveAuth().token();

    session.continueSession();
    await settled(session);
    expect(await hasSettled(token)).toBe(false);
    vi.mocked(auth.getRememberedAccount).mockReturnValue(undefined);
    session.signIn();
    await expect(token).rejects.toMatchObject({ reason: "superseded" });
  });

  it("fails Drive's wait when another account continues", async () => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);
    vi.mocked(auth.requestAccessToken).mockResolvedValue(NEW_TOKEN);
    vi.mocked(getAccountEmail).mockResolvedValueOnce("grace@example.com");

    const token = driveAuth().token();
    session.continueSession();
    await expect(token).rejects.toMatchObject({ reason: "superseded" });
    expect(screenOf(session)).toEqual({
      name: "home",
      email: "grace@example.com",
    });
  });

  it.each([
    [
      "here",
      (session: Session) => {
        session.signOut();
      },
    ],
    [
      "in another tab",
      () => {
        vi.mocked(auth.getRememberedAccount).mockReturnValue(undefined);
        onSignOutElsewhere();
      },
    ],
  ])("fails Drive's wait when the user signs out %s", async (_where, out) => {
    const session = await signedIn();
    vi.mocked(auth.getAccessToken).mockReturnValue(undefined);

    const token = driveAuth().token();
    out(session);
    await expect(token).rejects.toMatchObject({ reason: "superseded" });
  });

  it("refuses Drive a token while signed out", async () => {
    createSession();

    await expect(driveAuth().token()).rejects.toMatchObject({
      reason: "superseded",
    });
  });

  it("forgets a token Drive refused, but not a newer one", async () => {
    await signedIn();

    driveAuth().forget("example-older-token");
    expect(auth.clearToken).not.toHaveBeenCalled();
    driveAuth().forget(TOKEN);
    expect(auth.clearToken).toHaveBeenCalledOnce();
  });
});
