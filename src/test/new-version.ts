import { act } from "@testing-library/react";
import { expect, onTestFinished, vi } from "vitest";
import { watchVersion } from "../new-version.ts";

/** Hosting, serving `version` as its latest. */
function serve(version: string) {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ version }))),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The page shows again, as when the user comes back to the tab or the app. */
export function comeBack(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * Hosting serves a new version, which the page looks for as it shows again.
 * Once the test ends, Hosting serves the version running again and the page
 * stops looking, so that no other test sees a new version.
 */
export function deployNewVersion(): ReturnType<typeof vi.fn> {
  const stop = watchVersion();
  onTestFinished(async () => {
    const fetch = serve(__APP_VERSION__);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve));
    stop();
    vi.unstubAllGlobals();
  });
  return serve("9.9.9");
}
