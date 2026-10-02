import type { FileRef } from "./drive.ts";

/** The file's page in Google Drive, which opens what DriveMD does not. */
export function inDrive(file: FileRef): string {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
  );
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  return url.href;
}
