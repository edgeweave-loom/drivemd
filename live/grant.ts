import { open } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { getAccountEmail, type DriveAuth } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";

// The OAuth grant that lets the live checks act as a test account, whose
// Drive holds nothing but what the checks create. It never enters the
// repository, and no message quotes a token or the client secret.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
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
