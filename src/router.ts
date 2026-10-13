import { useSyncExternalStore } from "react";
import { requestFromDrive } from "./drive-ui.ts";
import { isDriveId, MY_DRIVE, type FileRef } from "./drive.ts";
import { isRecord } from "./is-record.ts";

/** A page of the app, which its URL names. */
export type Route =
  | { name: "home" }
  | { name: "shortcuts" }
  | { name: "shared-drives" }
  | { name: "shared-with-me" }
  | { name: "folder"; folder: FileRef }
  | { name: "search"; text: string }
  | { name: "file"; file: FileRef }
  /** Drive's New, which creates a Markdown file in the folder. */
  | { name: "new"; folder: FileRef }
  /** What the installed app was given to share, which led to no page. */
  | { name: "share" }
  | { name: "not-found" };

/** A step of the path the user took, as the breadcrumbs show it. */
export interface Crumb {
  name: string;
  href: string;
}

/** The page shown. */
export interface Place {
  route: Route;
  /** The page's path and query, in the form the app writes them. */
  href: string;
  /**
   * The path the user took to this page, which it ends, when they came
   * through the app's own links; kept by the browser's history.
   */
  trail: Crumb[] | undefined;
  /** The part of the page the URL leads to, after its `#`, as encoded. */
  fragment: string | undefined;
}

const NOT_FOUND: Route = { name: "not-found" };

export function routeOf(url: URL): Route {
  const { searchParams } = url;
  // A trailing slash, which some tools add, names the same page.
  const pathname = url.pathname.replace(/(.)\/$/, "$1");
  switch (pathname) {
    case "/":
      return { name: "home" };
    case "/my-drive":
      return { name: "folder", folder: { id: MY_DRIVE } };
    case "/shortcuts":
      return { name: "shortcuts" };
    case "/shared-drives":
      return { name: "shared-drives" };
    case "/shared-with-me":
      return { name: "shared-with-me" };
    case "/search": {
      // Drive searches word by word: the spaces between words say nothing.
      const text = (searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
      return { name: "search", text };
    }
    case "/edit": {
      const file = fileRef(searchParams.get("id"), searchParams);
      return file ? { name: "file", file } : NOT_FOUND;
    }
    case "/share":
      return { name: "share" };
    case "/open":
    case "/new": {
      // Drive's Open with, whose file has its own page, and Drive's New.
      const request = requestFromDrive(url);
      if (request?.action === "open")
        return { name: "file", file: request.file };
      return request ? { name: "new", folder: request.folder } : NOT_FOUND;
    }
  }
  const [, id] = /^\/folder\/([^/]+)$/.exec(pathname) ?? [];
  const folder = fileRef(id, searchParams);
  return folder ? { name: "folder", folder } : NOT_FOUND;
}

export function hrefOf(route: Exclude<Route, { name: "not-found" }>): string {
  switch (route.name) {
    case "home":
      return "/";
    case "shortcuts":
    case "shared-drives":
    case "shared-with-me":
    case "share":
      return `/${route.name}`;
    case "folder": {
      const { id, resourceKey } = route.folder;
      if (id === MY_DRIVE && resourceKey === undefined) return "/my-drive";
      return withKey(
        `/folder/${encodeURIComponent(id)}`,
        new URLSearchParams(),
        resourceKey,
      );
    }
    case "search":
      return `/search?${new URLSearchParams({ q: route.text }).toString()}`;
    case "file": {
      const { id, resourceKey } = route.file;
      return withKey("/edit", new URLSearchParams({ id }), resourceKey);
    }
    case "new": {
      // As Drive's New writes it, without the account it acted as.
      const { id, resourceKey } = route.folder;
      const state = JSON.stringify({
        action: "create",
        folderId: id,
        ...(resourceKey !== undefined && { folderResourceKey: resourceKey }),
      });
      return `/new?${new URLSearchParams({ state }).toString()}`;
    }
  }
}

function withKey(
  path: string,
  query: URLSearchParams,
  resourceKey: string | undefined,
): string {
  if (resourceKey !== undefined) query.set("resourcekey", resourceKey);
  return query.size === 0 ? path : `${path}?${query.toString()}`;
}

/** The item named in a URL, once its ID and resource key are well formed. */
export function fileRef(
  id: string | null | undefined,
  params: URLSearchParams,
): FileRef | undefined {
  if (id === null || id === undefined || !isDriveId(id)) return;
  const resourceKey = params.get("resourcekey");
  if (resourceKey === null) return { id };
  return isDriveId(resourceKey) ? { id, resourceKey } : undefined;
}

/** The page's href in the form hrefOf writes it, so each page has one. */
function canonical(url: URL): string {
  const route = routeOf(url);
  return route.name === "not-found" ? url.pathname + url.search : hrefOf(route);
}

const listeners = new Set<() => void>();
let snapshot: Place | undefined;

function changed(): void {
  snapshot = undefined;
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", changed);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlace(): Place {
  if (snapshot === undefined) {
    const url = new URL(window.location.href);
    const href = canonical(url);
    snapshot = {
      route: routeOf(url),
      href,
      trail: readTrail(history.state, href),
      fragment: fragmentOf(url),
    };
  }
  return snapshot;
}

export function usePlace(): Place {
  return useSyncExternalStore(subscribe, getPlace);
}

// What the page shown asks before the app leaves it, if anything.
let guard: ((to: Route) => boolean) | undefined;

/**
 * Has the app ask `ask` before it leaves the page, as one with unsaved
 * changes does; `ask` says whether to go. Undefined lifts the guard. The
 * browser's own Back is not asked.
 */
export function guardLeaving(ask: ((to: Route) => boolean) | undefined): void {
  guard = ask;
}

/**
 * Whether the user agrees to leave the page for `href`, which a tap asks
 * before it renews the token, so that a refusal opens no Google window.
 */
export function mayLeave(href: string): boolean {
  return !guard || guard(routeOf(new URL(href, window.location.origin)));
}

/** What follows a URL's `#`, if anything. */
function fragmentOf({ hash }: URL): string | undefined {
  return hash.length > 1 ? hash.slice(1) : undefined;
}

/**
 * Opens a page of the app, from its top, keeping the trail the user took for
 * its breadcrumbs, and the part of the page the address leads to after its
 * `#`. Opening the page already shown replaces it in the history, so that
 * Back does not show it twice, and keeps its trail unless given one.
 */
export function navigate(
  href: string,
  trail?: Crumb[],
  {
    /** The user already chose to leave, as when they trash the file shown. */
    asked = false,
    /** The page shown gives way to this one, which Back then skips. */
    replace = false,
  } = {},
): void {
  if (!asked && !mayLeave(href)) return;
  const url = new URL(href, window.location.origin);
  const page = canonical(url);
  const target = page + url.hash;
  const same = page === getPlace().href;
  const kept: unknown = same ? history.state : null;
  const state = trail === undefined ? kept : { trail };
  if (same || replace) history.replaceState(state, "", target);
  else history.pushState(state, "", target);
  // Back returns to where the page was left, as the browser keeps it.
  if (!same) window.scrollTo(0, 0);
  changed();
}

function readTrail(state: unknown, href: string): Crumb[] | undefined {
  const trail = isRecord(state) ? state.trail : undefined;
  if (!Array.isArray(trail) || !trail.every(isCrumb)) return;
  return trail.at(-1)?.href === href ? trail : undefined;
}

function isCrumb(value: unknown): value is Crumb {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.href === "string" &&
    isOwnPage(value.href)
  );
}

/** Whether a link stays in the app, rather than leading to another site. */
function isOwnPage(href: string): boolean {
  const { origin } = window.location;
  return (
    href.startsWith("/") &&
    URL.canParse(href, origin) &&
    new URL(href, origin).origin === origin
  );
}
