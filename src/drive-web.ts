import type { FileRef } from "./drive.ts";
import { fileRef, hrefOf, routeOf } from "./router.ts";

/** The file's page in Google Drive, which opens what DriveMD does not. */
export function inDrive(file: FileRef): string {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
  );
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  return url.href;
}

// The addresses Google gives an item, `/u/<n>` naming the account signed in.
const DRIVE_FILE = /^\/file(?:\/u\/\d+)?\/d\/([^/]+)/;
const DRIVE_FOLDER = /^\/drive(?:\/u\/\d+)?\/folders\/([^/]+)\/?$/;
const GOOGLE_DOCUMENT =
  /^\/(?:document|spreadsheets|presentation)(?:\/u\/\d+)?\/d\/([^/]+)/;

/**
 * The page of the app a pasted address leads to, if any: a file or a folder
 * in Google Drive, Google's own documents included, or a page of the app.
 */
export function linkedPage(text: string): string | undefined {
  const pasted = text.trim();
  if (!URL.canParse(pasted)) return;
  const url = new URL(pasted);
  if (url.origin === window.location.origin) {
    const route = routeOf(url);
    return route.name === "not-found" ? undefined : hrefOf(route) + url.hash;
  }
  if (url.protocol !== "https:") return;
  const { hostname, pathname, searchParams } = url;
  let id: string | null | undefined;
  if (hostname === "drive.google.com") {
    const [, folderId] = DRIVE_FOLDER.exec(pathname) ?? [];
    const folder = fileRef(folderId, searchParams);
    if (folder) return hrefOf({ name: "folder", folder });
    // Drive's older links name the item in the query.
    id =
      pathname === "/open" || pathname === "/uc"
        ? searchParams.get("id")
        : DRIVE_FILE.exec(pathname)?.[1];
  } else if (hostname === "docs.google.com") {
    id = GOOGLE_DOCUMENT.exec(pathname)?.[1];
  }
  const file = fileRef(id, searchParams);
  return file && hrefOf({ name: "file", file });
}
