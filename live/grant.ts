import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { getAccountEmail, type DriveAuth } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";

// The OAuth grant that lets the live checks act as a test account, whose
// Drive holds nothing but what the checks create. It never enters the
// repository, and no message quotes a token or the client secret.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const UNREVOKED =
  "remove DriveMD from that account's connected apps at https://myaccount.google.com/connections";
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

/** How the sign-in talks with the user, in their own terminal. */
export interface Prompt {
  show: (text: string) => void;
  ask: (question: string) => Promise<string>;
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

/**
 * Signs the test account in. It keeps the grant only if that account signed
 * in, and revokes any grant it cannot keep or that it replaces, so that no
 * lasting access outlives its use.
 */
export async function signIn(
  dir: string,
  account: string | undefined,
  prompt: Prompt,
): Promise<void> {
  if (account === undefined || account.trim() === "") {
    throw new Error("Set DRIVEMD_LIVE_ACCOUNT to the test account's address");
  }
  const client = await readClient(dir);
  if (!client) {
    throw new Error(
      `Save the desktop OAuth client as ${join(dir, "client.json")}, then chmod 600 it`,
    );
  }
  const older = await readGrant(dir).catch(() => undefined);
  const { url, pending } = startLogin(client, account);
  prompt.show(
    `Open this address, sign in as ${account} and allow access:\n\n${url}\n\n` +
      "The browser then fails to load 127.0.0.1: paste its address here.\n",
  );
  const code = codeFrom(await prompt.ask("Address: "), pending);
  const grant = await finishLogin(client, account, code, pending);
  await saveGrant(dir, grant).catch(async (error: unknown) => {
    await revoke(grant.refreshToken);
    throw error;
  });
  if (
    older !== undefined &&
    older.refreshToken !== grant.refreshToken &&
    !(await revoke(older.refreshToken))
  ) {
    prompt.show(`The grant it replaces could not be revoked: ${UNREVOKED}.\n`);
  }
  prompt.show(`Saved the grant for ${grant.account} in ${dir}.\n`);
}

/** Saves the grant readable only by the user, replacing any older one. */
export async function saveGrant(dir: string, grant: Grant): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const draft = join(dir, "grant.json.draft");
  // A draft that a failed save left, or anything else there, is removed
  // rather than written through.
  await rm(draft, { force: true });
  const file = await open(draft, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(grant));
    await file.sync();
  } finally {
    await file.close();
  }
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
  const url = new URL(address.trim());
  if (`${url.origin}${url.pathname}` !== REDIRECT_URI) {
    throw new Error("This is not the address Google sent the browser back to");
  }
  const { searchParams } = url;
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
 * signed in: a grant it cannot keep is revoked at once.
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
  if (typeof refreshToken !== "string") {
    throw new Error("Google sent no lasting grant");
  }
  const refuse = async (reason: string): Promise<never> => {
    const revoked = await revoke(refreshToken);
    throw new Error(
      `${reason}: ` +
        (revoked
          ? "the grant was revoked"
          : `it could not be revoked, so ${UNREVOKED}`),
    );
  };
  if (typeof accessToken !== "string") {
    return refuse("Google sent no access token");
  }
  const email = await getAccountEmail(accessToken).catch(() => undefined);
  if (email === undefined) return refuse("Drive could not tell who signed in");
  if (!sameAccount(email, account)) {
    return refuse(`Google signed in ${email}, not ${account.trim()}`);
  }
  return { account: email, refreshToken };
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
  if (!sameAccount(owner, grant.account)) {
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

/** Whether two addresses name the same account, whatever their case. */
function sameAccount(one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase();
}

/** Revokes a grant, telling whether Google confirmed it. */
function revoke(refreshToken: string): Promise<boolean> {
  return form(REVOKE_URL, { token: refreshToken }).then(
    (response) => response.ok,
    () => false,
  );
}

/** Posts a form to Google's OAuth server; errors never quote it. */
function form(url: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    body: new URLSearchParams(fields),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Posts a form, and reads Google's JSON answer. */
async function post(
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await form(url, fields);
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
