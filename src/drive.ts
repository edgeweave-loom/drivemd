import { isRecord } from "./is-record.ts";

// Only the fields the app shows; the drive scope needs no extra identity scope.
const ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";

export class DriveError extends Error {
  override readonly name = "DriveError";
  /** The HTTP status, or 0 when Drive could not be reached. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(ABOUT_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {
    throw new DriveError(0, "Google Drive could not be reached");
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new DriveError(
      response.status,
      errorMessage(body) ?? `Google Drive answered ${String(response.status)}`,
    );
  }
  const user = isRecord(body) ? body.user : undefined;
  const email = isRecord(user) ? user.emailAddress : undefined;
  if (typeof email !== "string" || email === "") {
    throw new DriveError(response.status, "Google Drive sent no email address");
  }
  return email;
}

function errorMessage(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  const message = isRecord(error) ? error.message : undefined;
  return typeof message === "string" && message !== "" ? message : undefined;
}
