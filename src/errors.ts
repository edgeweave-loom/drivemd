import { AuthError } from "./auth.ts";
import { DriveError } from "./drive.ts";

/** What went wrong with a Drive call, in the user's words. */
export function describeError(
  error: Error,
  missing = "Google Drive could not find it.",
): string {
  if (error instanceof AuthError) {
    return "Google sign-in did not finish, so nothing was done. Try again.";
  }
  if (!(error instanceof DriveError)) return "Something went wrong.";
  if (error.status === 404) return missing;
  if (error.status === 0) return `${error.message}. Check your connection.`;
  return `Google Drive refused the request: ${error.message}`;
}
