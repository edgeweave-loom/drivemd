import { onlineManager } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { isRecord } from "./is-record.ts";

/** How often a page that shows looks for a new version. */
const EVERY = 15 * 60 * 1000;

/**
 * Where a new version stands for the page: none served, or the page is
 * offline, where a reload would fail; served, but waiting for a note's
 * changes to save; offered; or put off with Later.
 */
export type NewVersion = "none" | "waiting" | "offered" | "later";

// The version Hosting serves, when it is not the one running.
let served: string | undefined;
// The version the user put off with Later.
let later: string | undefined;
// The notes with changes to save, or saving, which the offer waits for.
let holds = 0;
// The checks started, the latest of which says which version is served.
let checks = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const offline = onlineManager.subscribe(onChange);
  return () => {
    listeners.delete(onChange);
    offline();
  };
}

function current(): NewVersion {
  if (served === undefined || !onlineManager.isOnline()) return "none";
  if (holds > 0) return "waiting";
  return served === later ? "later" : "offered";
}

/**
 * Asks Hosting which version it serves, from the file the build writes
 * beside the app's page. Offline, it does not ask; a failed answer, as from
 * a server without the file, says nothing, and neither does one that a later
 * check overtook.
 */
async function check(): Promise<void> {
  if (!onlineManager.isOnline()) return;
  checks += 1;
  const id = checks;
  try {
    const response = await fetch("/version.json", { cache: "no-cache" });
    if (!response.ok) return;
    const file: unknown = await response.json();
    // An earlier check that answers late says nothing anew.
    if (id !== checks) return;
    if (!isRecord(file) || typeof file.version !== "string") return;
    const newer = file.version === __APP_VERSION__ ? undefined : file.version;
    if (newer === served) return;
    served = newer;
    changed();
  } catch {
    // Offline after all, or no such file, as in development.
  }
}

/**
 * Looks for a new version as the page shows again, as an iPhone's Home
 * Screen app does after days in memory, as the connection comes back,
 * every quarter of an hour while the page shows, and as soon as a part of
 * the app fails to load, which Hosting no longer serves once a new version
 * replaced it. Returns what stops looking.
 */
export function watchVersion(): () => void {
  const look = () => {
    void check();
  };
  const shown = () => {
    if (document.visibilityState === "visible") look();
  };
  const timer = setInterval(shown, EVERY);
  const online = onlineManager.subscribe((isOnline) => {
    if (isOnline) look();
  });
  document.addEventListener("visibilitychange", shown);
  window.addEventListener("vite:preloadError", look);
  return () => {
    clearInterval(timer);
    online();
    document.removeEventListener("visibilitychange", shown);
    window.removeEventListener("vite:preloadError", look);
  };
}

export function useNewVersion(): NewVersion {
  return useSyncExternalStore(subscribe, current);
}

/** Holds the offer of a new version while `holding`, as a note with changes to save does. */
export function useHoldNewVersion(holding: boolean): void {
  useEffect(() => {
    if (!holding) return;
    holds += 1;
    changed();
    return () => {
      holds -= 1;
      changed();
    };
  }, [holding]);
}

/** Puts off the version offered, until another is served. */
export function putOff(): void {
  later = served;
  changed();
}

/** Loads the version Hosting serves. */
export function reload(): void {
  window.location.reload();
}
