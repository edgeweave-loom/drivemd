import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { getAccountEmail, type DriveAuth } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";

// The OAuth grant that lets the live checks act as a test account, whose
// Drive holds nothing but what the checks create. It never enters the
// repository, and no message quotes a token or the client secret.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Google sends the browser back here; nothing listens, the user copies it. */
export const REDIRECT_URI = "http://127.0.0.1:8765/";
const EXPIRY_MARGIN_MS = 60_000;
const TIMEOUT_MS = 30_000;

/** The desktop OAuth client that the live checks sign in with. */
export interface Client {
  id: string;
  secret: string;
}

export interface Grant {
  account: string;
  refreshToken: string;
}

/** The secrets of a sign-in in progress. */
export interface Pending {
  verifier: string;
  state: string;
}

export interface LiveSession {
  account: string;
  auth: DriveAuth;
}

interface Minted {
  token: string;
  expiresAt: number;
}

export function configDir(): string {
  const chosen = process.env.DRIVEMD_LIVE_DIR;
  if (chosen === undefined || chosen === "") {
    return join(homedir(), ".config", "drivemd-live");
  }
  if (!isAbsolute(chosen)) {
    throw new Error("DRIVEMD_LIVE_DIR must be an absolute path");
  }
  return chosen;
}

export async function readClient(dir: string): Promise<Client | undefined> {
  const value = await readPrivate(join(dir, "client.json"));
  if (value === undefined) return;
  const installed = isRecord(value) ? value.installed : undefined;
  if (
    !isRecord(installed) ||
    typeof installed.client_id !== "string" ||
    typeof installed.client_secret !== "string"
  ) {
    throw new Error("client.json is not a desktop OAuth client");
  }
  return { id: installed.client_id, secret: installed.client_secret };
}

export async function readGrant(dir: string): Promise<Grant | undefined> {
  const value = await readPrivate(join(dir, "grant.json"));
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    typeof value.account !== "string" ||
    typeof value.refreshToken !== "string"
  ) {
    throw new Error("grant.json holds no grant: sign in again");
  }
  return { account: value.account, refreshToken: value.refreshToken };
}

/** Saves the grant readable only by the user, replacing any older one. */
export async function saveGrant(dir: string, grant: Grant): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const draft = join(dir, "grant.json.draft");
  await writeFile(draft, JSON.stringify(grant), { mode: 0o600 });
  await chmod(draft, 0o600);
  await rename(draft, join(dir, "grant.json"));
}

/** The address where the test account grants access, and its secrets. */
export function startLogin(
  client: Client,
  account: string,
): { url: string; pending: Pending } {
  const pending = {
    verifier: randomBytes(32).toString("base64url"),
    state: randomBytes(16).toString("base64url"),
  };
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    login_hint: account,
    state: pending.state,
    code_challenge: createHash("sha256")
      .update(pending.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return { url, pending };
}

/** The code in the address Google sent the browser back to. */
export function codeFrom(address: string, pending: Pending): string {
  const { searchParams } = new URL(address.trim());
  if (searchParams.get("state") !== pending.state) {
    throw new Error("This address comes from another sign-in");
  }
  const error = searchParams.get("error");
  if (error !== null) throw new Error(`Google refused: ${error}`);
  const code = searchParams.get("code");
  if (code === null) throw new Error("This address holds no code");
  return code;
}

/**
 * Trades the code for a lasting grant, kept only if the expected account
 * signed in: a grant made by any other account is revoked at once.
 */
export async function finishLogin(
  client: Client,
  account: string,
  code: string,
  pending: Pending,
): Promise<Grant> {
  const tokens = await post(TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    code_verifier: pending.verifier,
    redirect_uri: REDIRECT_URI,
    client_id: client.id,
    client_secret: client.secret,
  });
  const { access_token: accessToken, refresh_token: refreshToken } = tokens;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new Error("Google sent no lasting grant");
  }
  const email = await getAccountEmail(accessToken);
  if (email !== account) {
    const revoked = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(
      (response) => response.ok,
      () => false,
    );
    throw new Error(
      `Google signed in ${email}, not ${account}: ` +
        (revoked
          ? "the grant was revoked"
          : `it could not be revoked, remove "DriveMD live check" from that account's third-party connections`),
    );
  }
  return { account, refreshToken };
}

/**
 * The test account's session, or undefined until it has signed in. It checks
 * with Drive that the grant belongs to the account it names, so that the
 * checks never act on anyone else's Drive.
 */
export async function liveSession(
  dir: string,
): Promise<LiveSession | undefined> {
  const client = await readClient(dir);
  const grant = await readGrant(dir);
  if (!client || !grant) return;
  let current: Minted | undefined;
  let minting: Promise<Minted> | undefined;
  const auth: DriveAuth = {
    async token() {
      if (!current || current.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) {
        // Callers asking at once share one request.
        minting ??= mint(client, grant).finally(() => {
          minting = undefined;
        });
        current = await minting;
      }
      return current.token;
    },
    forget(refused) {
      if (current?.token === refused) current = undefined;
    },
  };
  const owner = await getAccountEmail(await auth.token());
  if (owner !== grant.account) {
    throw new Error(
      `The grant belongs to ${owner}, not ${grant.account}: sign in again`,
    );
  }
  return { account: grant.account, auth };
}

async function mint(client: Client, grant: Grant): Promise<Minted> {
  const minted = await post(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: grant.refreshToken,
    client_id: client.id,
    client_secret: client.secret,
  });
  const { access_token: token, expires_in: lifetime } = minted;
  if (typeof token !== "string" || typeof lifetime !== "number") {
    throw new Error("Google sent a malformed token");
  }
  if (!(lifetime > 0)) throw new Error("Google sent a malformed token");
  return { token, expiresAt: Date.now() + lifetime * 1000 };
}

/**
 * The JSON of a file that is the user's own and that nobody else can read,
 * or undefined if it is missing. Checks and reading go through one handle, so
 * the file cannot change in between, and errors never quote its content.
 */
async function readPrivate(path: string): Promise<unknown> {
  const file = await open(path, "r").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!file) return;
  try {
    const { mode, uid } = await file.stat();
    if ((mode & 0o077) !== 0) {
      throw new Error(`Others can read ${path}: chmod 600 it`);
    }
    if (uid !== userInfo().uid) throw new Error(`${path} is another user's`);
    const text = await file.readFile("utf8");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${path} is not valid JSON`);
    }
  } finally {
    await file.close();
  }
}

/** Posts a form to Google's OAuth server; errors never quote the request. */
async function post(
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(fields),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(body)) {
    const reason =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : String(response.status);
    throw new Error(`Google refused: ${reason}`);
  }
  return body;
}
