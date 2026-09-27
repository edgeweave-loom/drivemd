// All Google sign-in code lives here, so that swapping the popup token model
// for a token backend touches nothing else (see "Tokens" in docs/SPEC.md).

const GIS_URL = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const SCOPES = `${DRIVE_SCOPE} https://www.googleapis.com/auth/drive.install`;
const EXPIRY_MARGIN_MS = 5 * 60_000;

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
let client: google.accounts.oauth2.TokenClient | undefined;
let pending: PendingRequest | undefined;
let token: Token | undefined;

export function loadGoogleIdentity(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      reject(
        new AuthError("not_configured", "VITE_GOOGLE_CLIENT_ID is not set"),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = trustedGisUrl();
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
        reject(new AuthError("unavailable", "The GIS script defines no API"));
      }
    });
    script.addEventListener("error", () => {
      reject(new AuthError("unavailable", "The GIS script failed to load"));
    });
    document.head.append(script);
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
    tokenClient.requestAccessToken(
      loginHint === undefined
        ? { prompt: "select_account" }
        : { prompt: "", login_hint: loginHint },
    );
  });
}

/** The current token, or undefined once it has 5 minutes or less to live. */
export function getAccessToken(): string | undefined {
  if (!token || token.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) return;
  return token.accessToken;
}

function trustedGisUrl(): string {
  const policy = window.trustedTypes?.createPolicy("drivemd-gis", {
    createScriptURL: (url: string) => {
      if (url !== GIS_URL) throw new TypeError(`Refusing to load ${url}`);
      return url;
    },
  });
  // The sink takes the TrustedScriptURL itself; DOM typings only know strings.
  return (policy?.createScriptURL(GIS_URL) ?? GIS_URL) as string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
