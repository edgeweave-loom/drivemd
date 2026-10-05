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

// The addresses Google gives an item, after the `/a/<domain>` of older
// Workspace links, where `/u/<n>` picks one of several accounts signed in.
const GOOGLE = new Set(["drive.google.com", "docs.google.com"]);
const WORKSPACE = /^\/a\/[^/]+(?=\/)/;
const FOLDER = /^\/drive(?:\/u\/\d+)?\/folders\/([^/]+)\/?$/;
// A document published to the web, `/d/e/<code>`, names no item.
const FILE =
  /^\/(?:file|document|spreadsheets|presentation)(?:\/u\/\d+)?\/d\/(?!e\/)([^/]+)/;
// Older links name the item in their query, a file or a folder alike.
const BY_QUERY = /^(?:\/u\/\d+)?\/(?:open|uc)$/;

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
  if (url.protocol !== "https:" || !GOOGLE.has(url.hostname)) return;
  const { searchParams } = url;
  const path = url.pathname.replace(WORKSPACE, "");
  const folder = fileRef(FOLDER.exec(path)?.[1], searchParams);
  if (folder) return hrefOf({ name: "folder", folder });
  const id = BY_QUERY.test(path)
    ? searchParams.get("id")
    : FILE.exec(path)?.[1];
  const file = fileRef(id, searchParams);
  return file && hrefOf({ name: "file", file });
}

// Marks that often wrap or end a link in a message.
const AROUND = /^[<(["']+|[>)\]"'.,;:!?]+$/g;

/**
 * The page a share with the installed app leads to, if any (Web Share
 * Target): the first link that opens a page, in the shared address, then its
 * text, then its title, where apps put a link with words around it.
 */
export function sharedPage({ searchParams }: URL): string | undefined {
  for (const field of ["url", "text", "title"]) {
    for (const word of (searchParams.get(field) ?? "").split(/\s+/)) {
      const page = linkedPage(word.replace(AROUND, ""));
      if (page !== undefined) return page;
    }
  }
  return undefined;
}
