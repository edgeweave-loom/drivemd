import type { DriveAuth } from "../src/drive.ts";
import { isRecord } from "../src/is-record.ts";

// What the live checks share: the made-up items the test account can see, and
// calls to the Drive API for what the app's client does not do.

export const API = "https://www.googleapis.com/drive/v3";
export const FOLDER = "application/vnd.google-apps.folder";
export const SHORTCUT = "application/vnd.google-apps.shortcut";
/** A shared drive where the test account is a content manager. */
export const SHARED_DRIVE = "DriveMD live check";
/** Made up for the checks by another member of that shared drive. */
export const FROM_ANOTHER = "drivemd-live-from-another.md";
/** How long to wait for Drive's search index, which can lag. */
export const INDEX_TIMEOUT_MS = 120_000;
/** How often to look again meanwhile. */
export const INDEX_INTERVAL_MS = 3_000;

/** Calls on the Drive API as the test account. */
export function driveApi(auth: DriveAuth) {
  async function call(method: string, path: string, body?: object) {
    return fetch(`${API}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
    });
  }

  /** Drive's JSON answer, or its error message. */
  async function answer(response: Response): Promise<Record<string, unknown>> {
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body)) return body;
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    const message =
      typeof error.message === "string" ? `: ${error.message}` : "";
    throw new Error(`Drive answered ${String(response.status)}${message}`);
  }

  /** Makes an item, and gives its ID. */
  async function make(metadata: Record<string, unknown>): Promise<string> {
    const made = await answer(
      await call("POST", "files?supportsAllDrives=true&fields=id", metadata),
    );
    if (typeof made.id !== "string") throw new Error("Drive made no item");
    return made.id;
  }

  return { call, answer, make };
}
