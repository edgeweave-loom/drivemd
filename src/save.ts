import { DriveError, type Drive, type FileMetadata } from "./drive.ts";

/** What a save did: wrote the file, or found that someone else changed it. */
export type SaveResult = { saved: FileMetadata } | { conflict: FileMetadata };

/**
 * Writes the content over the file as it was opened, unless someone changed
 * it since: Drive cannot write on a condition, so its details are read again
 * just before. The first save of an editing session keeps the revision from
 * before the edits forever, out of Drive's cleanup of old revisions; a new
 * empty file has none yet. After a 401, the new token may take a while to
 * come, so the check runs again before the one retry.
 */
export async function saveText(
  drive: Drive,
  opened: FileMetadata,
  content: Uint8Array<ArrayBuffer>,
  { keep }: { keep: boolean },
): Promise<SaveResult> {
  async function attempt(): Promise<SaveResult> {
    const current = await drive.getMetadata(opened);
    if (
      current.md5Checksum !== opened.md5Checksum ||
      current.headRevisionId !== opened.headRevisionId
    ) {
      return { conflict: current };
    }
    if (keep && opened.headRevisionId !== undefined) {
      await drive.keepRevision(opened, opened.headRevisionId);
    }
    return { saved: await drive.saveContent(current, content) };
  }
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof DriveError && error.status === 401)) throw error;
    return attempt();
  }
}
