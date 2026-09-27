import * as auth from "./auth.ts";
import { AuthError, type AuthErrorReason } from "./auth.ts";
import { DriveError, getAccountEmail } from "./drive.ts";

export type Screen =
  | { name: "loading" }
  | { name: "sign-in" }
  | { name: "continue"; email: string }
  | { name: "home"; email: string };

export interface SessionState {
  screen: Screen;
  /** Whether Google's script is ready to open its sign-in popup. */
  google: "loading" | "ready" | "failed";
  /** A sign-in the user started has not settled yet. */
  waiting: boolean;
  message: string | undefined;
  /** What the security policy blocked that sign-in depends on, if anything. */
  blocked: string | undefined;
}

/**
 * The sign-in state behind the screens, for `useSyncExternalStore`. signIn
 * opens Google's popup, so call it straight from a click or tap handler.
 */
export interface Session {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SessionState;
  signIn: () => void;
  signOut: () => void;
  retry: () => void;
}

const AUTH_MESSAGES: Record<AuthErrorReason, string | undefined> = {
  not_configured: "Sign-in is not configured: VITE_GOOGLE_CLIENT_ID is empty.",
  unavailable:
    "Google sign-in could not load. Check your connection, then try again.",
  popup_blocked:
    "The browser blocked Google's sign-in window. Allow pop-ups for this site, then try again.",
  popup_closed: "Google's sign-in window closed before signing in.",
  access_denied: "You declined access to your Google account.",
  scope_denied:
    "DriveMD needs access to your Google Drive. Try again and allow it.",
  superseded: undefined,
  failed: "Google sign-in failed. Try again.",
};

export function createSession(): Session {
  const listeners = new Set<() => void>();
  // Each user action starts a new epoch; results from an older one are dropped.
  let epoch = 0;
  let state: SessionState = {
    screen: { name: "sign-in" },
    google: "loading",
    waiting: false,
    message: undefined,
    blocked: undefined,
  };

  function update(changes: Partial<SessionState>): void {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  function signedOutScreen(): Screen {
    const email = auth.getRememberedAccount();
    return email === undefined
      ? { name: "sign-in" }
      : { name: "continue", email };
  }

  async function finish(
    token: Promise<string>,
    run: number,
    expectedEmail?: string,
  ): Promise<void> {
    try {
      const email = await getAccountEmail(await token);
      if (run !== epoch) return;
      if (expectedEmail !== undefined && email !== expectedEmail) {
        auth.clearToken();
        update({ screen: signedOutScreen(), waiting: false });
        return;
      }
      auth.rememberAccount(email);
      update({
        screen: { name: "home", email },
        waiting: false,
        message: undefined,
      });
    } catch (error) {
      if (run !== epoch) return;
      if (error instanceof DriveError && error.status === 401)
        auth.clearToken();
      update({
        screen: signedOutScreen(),
        waiting: false,
        message: messageFor(error),
      });
    }
  }

  function start(request: Promise<string>): void {
    epoch += 1;
    update({ waiting: true, message: undefined });
    void finish(request, epoch);
  }

  function loadGoogle(): void {
    update({ google: "loading", message: undefined });
    auth.loadGoogleIdentity().then(
      () => {
        update({ google: "ready" });
      },
      (error: unknown) => {
        update({ google: "failed", message: messageFor(error) });
      },
    );
  }

  function signedOutElsewhere(): void {
    epoch += 1;
    auth.clearToken();
    update({
      screen: signedOutScreen(),
      waiting: false,
      message: "This tab was signed out from another tab.",
    });
  }

  // A tab coming back to the foreground may have missed a sign-out, or
  // outlived its token.
  function checkSession(): void {
    const { screen } = state;
    if (document.visibilityState === "hidden" || screen.name !== "home") return;
    if (auth.getRememberedAccount() !== screen.email) {
      signedOutElsewhere();
    } else if (auth.getAccessToken() === undefined) {
      update({ screen: { name: "continue", email: screen.email } });
    }
  }

  loadGoogle();
  // A stored token counts only for the account the device still remembers:
  // otherwise it predates a sign-out made while this tab was not running.
  const token = auth.getAccessToken();
  const account = auth.getRememberedAccount();
  if (token === undefined || account === undefined) {
    update({ screen: signedOutScreen() });
  } else {
    update({ screen: { name: "loading" }, waiting: true });
    void finish(Promise.resolve(token), epoch, account);
  }
  document.addEventListener("visibilitychange", checkSession);
  window.addEventListener("pageshow", checkSession);
  document.addEventListener("securitypolicyviolation", (event) => {
    const blocked = describeBlock(event);
    if (blocked !== undefined) update({ blocked });
  });
  auth.onSignOutElsewhere(() => {
    if (state.screen.name !== "sign-in" || state.waiting) signedOutElsewhere();
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    signIn() {
      start(auth.requestAccessToken());
    },
    signOut() {
      epoch += 1;
      auth.signOut();
      update({
        screen: { name: "sign-in" },
        waiting: false,
        message: "You're signed out.",
      });
    },
    retry: loadGoogle,
  };
}

const SIGN_IN_ORIGINS = new Set([
  "https://accounts.google.com",
  "https://www.googleapis.com",
]);

/**
 * Describes a violation that sign-in depends on, for diagnosing it on a phone
 * without devtools. Other violations, such as an extension's injected script
 * or a style Google's script inlines for widgets the app does not use, are
 * ignored; so is the full blocked URL, which could carry more than an origin.
 */
function describeBlock(
  event: SecurityPolicyViolationEvent,
): string | undefined {
  if (event.disposition === "report") return;
  const blocked = URL.canParse(event.blockedURI)
    ? new URL(event.blockedURI).origin
    : event.blockedURI;
  const trustedTypes = event.effectiveDirective.includes("trusted-types");
  if (!trustedTypes && !SIGN_IN_ORIGINS.has(blocked)) return;
  return `The browser's security policy blocked ${blocked} (${event.effectiveDirective}).`;
}

function messageFor(error: unknown): string | undefined {
  if (error instanceof AuthError) return AUTH_MESSAGES[error.reason];
  if (error instanceof DriveError) {
    if (error.status === 401) return;
    if (error.status === 0) return `${error.message}. Check your connection.`;
    if (error.status < 400) return error.message;
    return `Google Drive refused the request: ${error.message}`;
  }
  return "Something went wrong. Try again.";
}
