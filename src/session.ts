import * as auth from "./auth.ts";
import { AuthError, type AuthErrorReason } from "./auth.ts";
import {
  createDrive,
  DriveError,
  getAccountEmail,
  type Drive,
} from "./drive.ts";

export type Screen =
  | { name: "loading"; email: string }
  | { name: "sign-in" }
  | { name: "continue"; email: string }
  | { name: "home"; email: string };

export interface SessionState {
  screen: Screen;
  /** Whether Google's script is ready to open its sign-in popup. */
  google: "loading" | "ready" | "failed" | "unconfigured";
  /** A sign-in the user started has not settled yet. */
  waiting: boolean;
  message: string | undefined;
  /** What the security policy blocked that sign-in depends on, if anything. */
  blocked: string | undefined;
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
  /** Drive, as the signed-in user: its calls wait for Continue when needed. */
  drive: Drive;
  /**
   * Renews an expired token by opening Google's popup, so call it first in a
   * tap or click handler that leads to Drive calls.
   */
  renew: () => void;
}

interface Waiter {
  /** The account the call was made for. */
  account: string;
  resolve: (token: string) => void;
  reject: (error: AuthError) => void;
}

const AUTH_MESSAGES: Record<AuthErrorReason, string | undefined> = {
  not_configured: "Sign-in is not configured: VITE_GOOGLE_CLIENT_ID is empty.",
  unavailable:
    "Google sign-in could not load. Check your connection, then try again.",
  popup_blocked:
    "The browser blocked Google's sign-in window. Allow pop-ups for this site, then try again.",
  access_denied: "You declined access to your Google account.",
  scope_denied:
    "DriveMD needs access to your Google Drive. Try again and allow it.",
  superseded: undefined,
  failed: "Google sign-in failed. Try again.",
};

/**
 * `driveAccount` is the account Drive acted as, when its Open with or New
 * opened the tab. Without a token, such a tab signs in afresh rather than
 * continuing as the account the device remembers, which may be another: the
 * user picks the account in Google's chooser, from Drive's, so that a link
 * never picks it for them.
 */
export function createSession(driveAccount?: string): Session {
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
  // Drive calls waiting for a token that only a tap can bring.
  const waiters = new Set<Waiter>();
  // The account Drive acted as, until the tab has signed in.
  let requested = driveAccount;

  function update(changes: Partial<SessionState>): void {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  function signedOutScreen(): Screen {
    const email = auth.getRememberedAccount();
    return email === undefined || requested !== undefined
      ? { name: "sign-in" }
      : { name: "continue", email };
  }

  function settleWaiters(settle: (waiter: Waiter) => void): void {
    for (const waiter of waiters) settle(waiter);
    waiters.clear();
  }

  function failWaiters(reason: string): void {
    settleWaiters((waiter) => {
      waiter.reject(new AuthError("superseded", reason));
    });
  }

  /**
   * The token for a Drive call, once Drive has confirmed it belongs to the
   * account shown, and a tap has renewed it if need be.
   */
  function driveToken(): Promise<string> {
    const { screen } = state;
    if (!("email" in screen)) {
      return Promise.reject(new AuthError("superseded", "Nobody is signed in"));
    }
    // Until its check is over, a new token could be another account's.
    const checked = screen.name === "home" && !state.waiting;
    const current = checked ? auth.getAccessToken() : undefined;
    if (current !== undefined) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      waiters.add({ account: screen.email, resolve, reject });
      // Without a renewal under way, only a tap on Continue can bring one.
      if (checked) {
        update({ screen: { name: "continue", email: screen.email } });
      }
    });
  }

  async function finish(
    token: Promise<string>,
    run: number,
    expectedEmail?: string,
  ): Promise<void> {
    try {
      const accessToken = await token;
      const email = await getAccountEmail(accessToken);
      if (run !== epoch) return;
      if (expectedEmail !== undefined && email !== expectedEmail) {
        auth.clearToken();
        update({
          screen: signedOutScreen(),
          waiting: false,
          message: "Google returned another account. Continue with this one.",
        });
        return;
      }
      auth.rememberAccount(email);
      requested = undefined;
      update({
        screen: { name: "home", email },
        waiting: false,
        message: undefined,
        blocked: undefined,
      });
      // A call made for one account never goes out with another's token.
      settleWaiters((waiter) => {
        if (waiter.account === email) {
          waiter.resolve(accessToken);
        } else {
          waiter.reject(
            new AuthError("superseded", "Another account signed in"),
          );
        }
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

  function start(request: Promise<string>, expectedEmail?: string): void {
    epoch += 1;
    update({ waiting: true, message: undefined });
    void finish(request, epoch, expectedEmail);
  }

  function loadGoogle(): void {
    update({ google: "loading", message: undefined, blocked: undefined });
    auth.loadGoogleIdentity().then(
      () => {
        update({ google: "ready" });
      },
      (error: unknown) => {
        const unconfigured =
          error instanceof AuthError && error.reason === "not_configured";
        update({
          google: unconfigured ? "unconfigured" : "failed",
          message: messageFor(error),
        });
      },
    );
  }

  function signedOutElsewhere(): void {
    epoch += 1;
    auth.clearToken();
    failWaiters("The user signed out in another tab");
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
    update({ screen: { name: "loading", email: account }, waiting: true });
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
      start(
        requested === undefined
          ? auth.requestAccessToken()
          : auth.requestAccessToken(requested, { choose: true }),
      );
    },
    continueSession() {
      const { screen } = state;
      if (screen.name !== "continue") return;
      const current = auth.getAccessToken();
      // A fresh popup may sign in another account on purpose; a reused token
      // must still belong to the account shown.
      if (current === undefined) start(auth.requestAccessToken(screen.email));
      else start(Promise.resolve(current), screen.email);
    },
    signOut() {
      epoch += 1;
      requested = undefined;
      auth.signOut();
      failWaiters("The user signed out");
      update({
        screen: { name: "sign-in" },
        waiting: false,
        message: "You're signed out.",
      });
    },
    retry: loadGoogle,
    drive: createDrive({
      token: driveToken,
      forget(refused) {
        if (auth.getAccessToken() === refused) auth.clearToken();
      },
    }),
    renew() {
      const { screen } = state;
      if (screen.name !== "home" || auth.getAccessToken() !== undefined) return;
      start(auth.requestAccessToken(screen.email), screen.email);
    },
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
  const directive = event.effectiveDirective;
  const googleLoad =
    /^(script|connect|frame)-src/.test(directive) &&
    SIGN_IN_ORIGINS.has(blocked);
  if (!googleLoad && !directive.includes("trusted-types")) return;
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
