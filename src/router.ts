import { useSyncExternalStore } from "react";
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
    case "/search":
      return { name: "search", text: searchParams.get("q") ?? "" };
    case "/edit": {
      const file = fileRef(searchParams.get("id"), searchParams);
      return file ? { name: "file", file } : NOT_FOUND;
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
function fileRef(
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
    };
  }
  return snapshot;
}

export function usePlace(): Place {
  return useSyncExternalStore(subscribe, getPlace);
}

/**
 * Opens a page of the app, keeping the trail the user took for its
 * breadcrumbs. Opening the page already shown replaces it in the history,
 * so that Back does not show it twice, and keeps its trail unless given one.
 */
export function navigate(href: string, trail?: Crumb[]): void {
  const target = canonical(new URL(href, window.location.origin));
  if (target === getPlace().href) {
    const state: unknown = trail === undefined ? history.state : { trail };
    history.replaceState(state, "", target);
  } else {
    history.pushState(trail === undefined ? null : { trail }, "", target);
  }
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
