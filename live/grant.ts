import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DriveAuth } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";

// The OAuth grant that lets the live checks act as a test account, whose
// Drive holds nothing but what the checks create. It never enters the
// repository, and no message quotes a token or the client secret.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXPIRY_MARGIN_MS = 60_000;

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

export function configDir(): string {
  return (
    process.env.DRIVEMD_LIVE_DIR ?? join(homedir(), ".config", "drivemd-live")
  );
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

/** The test account's session, or undefined until it has signed in. */
export async function liveSession(
  dir: string,
): Promise<LiveSession | undefined> {
  const client = await readClient(dir);
  const grant = await readGrant(dir);
  if (!client || !grant) return;
  let current: { token: string; expiresAt: number } | undefined;
  return {
    account: grant.account,
    auth: {
      async token() {
        if (!current || current.expiresAt - Date.now() <= EXPIRY_MARGIN_MS) {
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
          current = { token, expiresAt: Date.now() + lifetime * 1000 };
        }
        return current.token;
      },
      forget(refused) {
        if (current?.token === refused) current = undefined;
      },
    },
  };
}

/** The JSON of a file only its owner can read, or undefined if it is missing. */
async function readPrivate(path: string): Promise<unknown> {
  const mode = await stat(path).then(
    (stats) => stats.mode,
    (error: unknown) => {
      if (isRecord(error) && error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (mode === undefined) return;
  if ((mode & 0o077) !== 0) {
    throw new Error(`Others can read ${path}: chmod 600 it`);
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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
