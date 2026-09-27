// All Google sign-in code lives here, so that swapping the popup token model
// for a token backend touches nothing else (see "Tokens" in docs/SPEC.md).

const GIS_URL = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const SCOPES = `${DRIVE_SCOPE} https://www.googleapis.com/auth/drive.install`;
const EXPIRY_MARGIN_MS = 5 * 60_000;
const TOKEN_KEY = "drivemd.token";
const ACCOUNT_KEY = "drivemd.account";

export type AuthErrorReason =
  | "not_configured"
  | "unavailable"
  | "popup_blocked"
  | "popup_closed"
  | "access_denied"
  | "scope_denied"
  | "superseded"
  | "failed";

export class AuthError extends Error {
  override readonly name = "AuthError";
  readonly reason: AuthErrorReason;

  constructor(reason: AuthErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

interface Token {
  accessToken: string;
  expiresAt: number;
}

interface PendingRequest {
  resolve: (accessToken: string) => void;
  reject: (error: AuthError) => void;
}

let loading: Promise<void> | undefined;
let gisUrl: string | undefined;
let client: google.accounts.oauth2.TokenClient | undefined;
let pending: PendingRequest | undefined;
let token: Token | undefined;
let restored = false;

/** Loads Google's script once; after a failure, the next call tries again. */
export function loadGoogleIdentity(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      reject(
        new AuthError("not_configured", "VITE_GOOGLE_CLIENT_ID is not set"),
      );
      return;
    }
    const script = document.createElement("script");
    const fail = (message: string) => {
      script.remove();
      reject(new AuthError("unavailable", message));
    };
    try {
      script.src = trustedGisUrl();
    } catch {
      fail("The page refused the Trusted Types policy");
      return;
    }
    script.addEventListener("load", () => {
      try {
        client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: handleTokenResponse,
          error_callback: handleClientError,
        });
        resolve();
      } catch {
        fail("The GIS script defines no API");
      }
    });
    script.addEventListener("error", () => {
      fail("The GIS script failed to load");
    });
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/**
 * Opens Google's popup, so it must run synchronously inside a click or tap
 * handler: browsers block popups opened after an `await`. Without a hint the
 * user picks an account; with one, the popup closes by itself when Google
 * needs nothing from the user.
 */
export function requestAccessToken(loginHint?: string): Promise<string> {
  const tokenClient = client;
  if (!tokenClient) {
    return Promise.reject(
      new AuthError("unavailable", "Google Identity Services has not loaded"),
    );
  }
  takePending()?.reject(
    new AuthError("superseded", "A newer sign-in request replaced this one"),
  );
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    try {
      tokenClient.requestAccessToken(
        loginHint === undefined
          ? { prompt: "select_account" }
          : { prompt: "", login_hint: loginHint },
      );
    } catch {
      takePending();
      reject(new AuthError("failed", "Google's token client failed"));
    }
  });
}

/** The current token, or undefined once it has 5 minutes or less to live. */
export function getAccessToken(): string | undefined {
  if (!restored) {
    token ??= readStoredToken();
    restored = true;
  }
  if (token && token.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) clearToken();
  return token?.accessToken;
}

export function clearToken(): void {
  token = undefined;
  write("sessionStorage", TOKEN_KEY, null);
}

export function getRememberedAccount(): string | undefined {
  const email = read("localStorage", ACCOUNT_KEY);
  if (email === null || email === "") return;
  return email;
}

export function rememberAccount(email: string): void {
  write("localStorage", ACCOUNT_KEY, email);
}

/**
 * Forgets the session on this device. It does not revoke the grant, which
 * would sign the user out of DriveMD on every device.
 */
export function signOut(): void {
  takePending()?.reject(new AuthError("superseded", "The user signed out"));
  clearToken();
  write("localStorage", ACCOUNT_KEY, null);
}

/**
 * Calls the listener after another tab of this browser signed out, once this
 * tab has forgotten its own token.
 */
export function onSignOutElsewhere(listener: () => void): void {
  window.addEventListener("storage", (event) => {
    if (event.key !== ACCOUNT_KEY && event.key !== null) return;
    if (getRememberedAccount() !== undefined) return;
    clearToken();
    listener();
  });
}

// Created once: a page cannot register two policies with the same name.
function trustedGisUrl(): string {
  if (gisUrl === undefined) {
    const policy = window.trustedTypes?.createPolicy("drivemd-gis", {
      createScriptURL: (url: string) => {
        if (url !== GIS_URL) throw new TypeError(`Refusing to load ${url}`);
        return url;
      },
    });
    // The sink takes the TrustedScriptURL itself; DOM typings only know strings.
    gisUrl = (policy?.createScriptURL(GIS_URL) ?? GIS_URL) as string;
  }
  return gisUrl;
}

function takePending(): PendingRequest | undefined {
  const request = pending;
  pending = undefined;
  return request;
}

function handleTokenResponse(response: unknown): void {
  const request = takePending();
  if (!request) return;
  if (!isRecord(response)) {
    request.reject(new AuthError("failed", "Google sent no token response"));
    return;
  }
  const {
    access_token: accessToken,
    expires_in: expiresIn,
    scope,
    error,
  } = response;
  if (typeof error === "string") {
    const reason = error === "access_denied" ? "access_denied" : "failed";
    request.reject(new AuthError(reason, `Google refused the token: ${error}`));
    return;
  }
  const lifetimeSeconds = Number(expiresIn);
  if (typeof accessToken !== "string" || !(lifetimeSeconds > 0)) {
    request.reject(new AuthError("failed", "Google sent a malformed token"));
    return;
  }
  if (typeof scope !== "string" || !scope.split(" ").includes(DRIVE_SCOPE)) {
    request.reject(
      new AuthError("scope_denied", "Drive access was not granted"),
    );
    return;
  }
  token = { accessToken, expiresAt: Date.now() + lifetimeSeconds * 1000 };
  write("sessionStorage", TOKEN_KEY, JSON.stringify(token));
  request.resolve(accessToken);
}

function handleClientError(error: unknown): void {
  const type = isRecord(error) ? error.type : undefined;
  const reason =
    type === "popup_failed_to_open"
      ? "popup_blocked"
      : type === "popup_closed"
        ? "popup_closed"
        : "failed";
  takePending()?.reject(
    new AuthError(reason, "The Google sign-in window failed"),
  );
}

function readStoredToken(): Token | undefined {
  const stored = read("sessionStorage", TOKEN_KEY);
  if (stored === null) return;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      isRecord(value) &&
      typeof value.accessToken === "string" &&
      typeof value.expiresAt === "number"
    ) {
      return { accessToken: value.accessToken, expiresAt: value.expiresAt };
    }
  } catch {
    // A malformed value counts as no token.
  }
  return;
}

type StorageArea = "localStorage" | "sessionStorage";

// Browsers can refuse storage (private modes, blocked site data); the session
// then lives in memory only.
function read(area: StorageArea, key: string): string | null {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

function write(area: StorageArea, key: string, value: string | null): void {
  try {
    if (value === null) window[area].removeItem(key);
    else window[area].setItem(key, value);
  } catch {
    // See read().
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
