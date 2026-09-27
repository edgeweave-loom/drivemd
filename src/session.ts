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
}

/**
 * The sign-in state behind the screens, for `useSyncExternalStore`. signIn and
 * continueSession open Google's popup, so call them straight from a click or
 * tap handler.
 */
export interface Session {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SessionState;
  signIn: () => void;
  continueSession: () => void;
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

  function checkExpiry(): void {
    const { screen } = state;
    if (document.visibilityState === "hidden" || screen.name !== "home") return;
    if (auth.getAccessToken() === undefined) {
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
  document.addEventListener("visibilitychange", checkExpiry);
  window.addEventListener("pageshow", checkExpiry);
  document.addEventListener("securitypolicyviolation", (event) => {
    update({
      message: `The browser blocked ${event.blockedURI} (${event.effectiveDirective}).`,
    });
  });
  auth.onSignOutElsewhere(() => {
    epoch += 1;
    update({
      screen: { name: "sign-in" },
      waiting: false,
      message: "You signed out in another tab.",
    });
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
    continueSession() {
      const { screen } = state;
      if (screen.name !== "continue") return;
      const current = auth.getAccessToken();
      start(
        current === undefined
          ? auth.requestAccessToken(screen.email)
          : Promise.resolve(current),
      );
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
