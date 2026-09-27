import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "./auth.ts";
import { AuthError, type AuthErrorReason } from "./auth.ts";
import { DriveError, getAccountEmail } from "./drive.ts";
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
}));

vi.mock("./drive.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drive.ts")>()),
  getAccountEmail: vi.fn(),
}));

const TOKEN = "example-access-token";
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

  it("reopens this tab's session with the email Drive reports", async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue(TOKEN);
    const session = createSession();

    expect(screenOf(session)).toEqual({ name: "loading" });
    await settled(session);
    expect(screenOf(session)).toEqual({ name: "home", email: EMAIL });
    expect(getAccountEmail).toHaveBeenCalledWith(TOKEN);
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
    ["popup_closed", /closed/],
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

  it("reports Drive's refusal after sign-in", async () => {
    vi.mocked(auth.requestAccessToken).mockResolvedValue(TOKEN);
    vi.mocked(getAccountEmail).mockRejectedValue(
      new DriveError(403, "Drive API is disabled"),
    );
    const session = createSession();

    session.signIn();
    await settled(session);
    expect(session.getSnapshot().message).toMatch(/Drive API is disabled/);
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
});
