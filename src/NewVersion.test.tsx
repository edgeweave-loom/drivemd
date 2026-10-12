import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comeBack } from "./test/new-version.ts";

// What the page knows of the version served holds for the page: each test
// loads the modules afresh.
let watchVersion: typeof import("./new-version.ts").watchVersion;
let useHoldNewVersion: typeof import("./new-version.ts").useHoldNewVersion;
let NewVersion: typeof import("./NewVersion.tsx").NewVersion;
let Missing: typeof import("./Missing.tsx").Missing;
let Account: typeof import("./Account.tsx").Account;
let onlineManager: typeof import("@tanstack/react-query").onlineManager;
let stop: () => void;

const TITLE = "A new version of DriveMD is ready";

/** Hosting, answering the version file with `answer`. */
function serve(answer: () => Promise<Response>) {
  const fetch = vi.fn(answer);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Hosting, serving `version` as its latest. */
function serveVersion(version: string) {
  return serve(() =>
    Promise.resolve(new Response(JSON.stringify({ version }))),
  );
}

function banner() {
  return screen.queryByRole("region", { name: TITLE });
}

/** A note with changes to save, or saving, while `holding`. */
function Note({ holding }: { holding: boolean }) {
  useHoldNewVersion(holding);
  return null;
}

describe("a new version of DriveMD", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ watchVersion, useHoldNewVersion } = await import("./new-version.ts"));
    ({ NewVersion } = await import("./NewVersion.tsx"));
    ({ Missing } = await import("./Missing.tsx"));
    ({ Account } = await import("./Account.tsx"));
    ({ onlineManager } = await import("@tanstack/react-query"));
    stop = watchVersion();
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is offered once the page shows again, from the version file Hosting serves", async () => {
    const fetch = serveVersion("9.9.9");
    render(<NewVersion />);
    expect(banner()).toBeNull();

    comeBack();

    expect(
      await screen.findByRole("region", { name: TITLE }),
    ).toHaveTextContent("Reload DriveMD to use it.");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/version.json", {
      cache: "no-cache",
    });
  });

  it("is not offered while Hosting serves the version running", async () => {
    const fetch = serveVersion(__APP_VERSION__);
    render(<NewVersion />);

    comeBack();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(banner()).toBeNull();
  });

  it("is no longer offered once Hosting serves the version running again", async () => {
    serveVersion("9.9.9");
    render(<NewVersion />);
    comeBack();
    await screen.findByRole("region", { name: TITLE });

    serveVersion(__APP_VERSION__);
    comeBack();

    await waitFor(() => {
      expect(banner()).toBeNull();
    });
  });

  it.each([
    ["the request fails", () => Promise.reject(new TypeError("Load failed"))],
    [
      "Hosting has no such file",
      () => Promise.resolve(new Response("", { status: 404 })),
    ],
    [
      "the server answers with the app's page, as in development",
      () => Promise.resolve(new Response("<!doctype html>")),
    ],
    [
      "the file names no version",
      () => Promise.resolve(new Response(JSON.stringify({ version: 9 }))),
    ],
    ["the file holds no object", () => Promise.resolve(new Response("null"))],
    [
      "Hosting fails, even with a version in its answer",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ version: "9.9.9" }), { status: 503 }),
        ),
    ],
  ])("says nothing when %s", async (_, answer) => {
    const fetch = serve(answer);
    render(<NewVersion />);

    comeBack();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("follows the latest check, whichever answers first", async () => {
    let answerFirst: (response: Response) => void = () => undefined;
    serve(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    render(<NewVersion />);
    comeBack();
    serveVersion("9.9.9");
    comeBack();
    await screen.findByRole("region", { name: TITLE });

    answerFirst(new Response(JSON.stringify({ version: __APP_VERSION__ })));
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());

    expect(banner()).toBeVisible();
  });

  it("is looked for every quarter of an hour while the page shows, and not while it is hidden", () => {
    stop();
    vi.useFakeTimers();
    stop = watchVersion();
    const fetch = serveVersion(__APP_VERSION__);

    vi.advanceTimersByTime(15 * 60 * 1000 - 1);
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledOnce();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("is looked for as the connection comes back, and neither looked for nor offered offline", async () => {
    const fetch = serveVersion("9.9.9");
    render(<NewVersion />);
    act(() => {
      onlineManager.setOnline(false);
    });

    comeBack();
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByRole("region", { name: TITLE })).toBeVisible();
    expect(fetch).toHaveBeenCalledOnce();

    act(() => {
      onlineManager.setOnline(false);
    });
    expect(banner()).toBeNull();
    act(() => {
      onlineManager.setOnline(true);
    });
  });

  it("is looked for as soon as a part of the app fails to load", async () => {
    serveVersion("9.9.9");
    render(<NewVersion />);

    act(() => {
      window.dispatchEvent(new Event("vite:preloadError"));
    });

    expect(await screen.findByRole("region", { name: TITLE })).toBeVisible();
  });

  it("is no longer looked for once the page stops watching", () => {
    stop();
    vi.useFakeTimers();
    stop = watchVersion();
    const fetch = serveVersion("9.9.9");
    stop();

    comeBack();
    act(() => {
      window.dispatchEvent(new Event("vite:preloadError"));
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits while a note has changes to save, or saves them", async () => {
    serveVersion("9.9.9");
    const { rerender } = render(
      <>
        <NewVersion />
        <Note holding />
      </>,
    );

    comeBack();
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();

    rerender(
      <>
        <NewVersion />
        <Note holding={false} />
      </>,
    );
    expect(screen.getByRole("region", { name: TITLE })).toBeVisible();
  });

  it("reloads the page on Reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    serveVersion("9.9.9");
    render(<NewVersion />);
    comeBack();

    fireEvent.click(
      within(await screen.findByRole("region", { name: TITLE })).getByRole(
        "button",
        { name: "Reload" },
      ),
    );

    expect(reload).toHaveBeenCalledOnce();
  });

  it("is put off by Later, until a newer version still is served", async () => {
    serveVersion("9.9.9");
    render(<NewVersion />);
    comeBack();

    fireEvent.click(
      within(await screen.findByRole("region", { name: TITLE })).getByRole(
        "button",
        { name: "Later" },
      ),
    );
    expect(banner()).toBeNull();
    comeBack();
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();

    serveVersion("9.9.10");
    comeBack();
    expect(await screen.findByRole("region", { name: TITLE })).toBeVisible();
  });

  describe("in the account's menu", () => {
    function update() {
      return screen.queryByRole("button", { name: "Reload to update" });
    }

    it("is offered, Later or not, and reloads the page", async () => {
      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      serveVersion("9.9.9");
      render(
        <>
          <NewVersion />
          <Account email="ada@example.com" onSignOut={() => undefined} />
        </>,
      );
      expect(update()).toBeNull();

      comeBack();
      fireEvent.click(await screen.findByRole("button", { name: "Later" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Account, ada@example.com" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload to update" }));

      expect(reload).toHaveBeenCalledOnce();
    });

    it("waits while a note has changes to save", async () => {
      const fetch = serveVersion("9.9.9");
      render(
        <>
          <Account email="ada@example.com" onSignOut={() => undefined} />
          <Note holding />
        </>,
      );

      comeBack();
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
      });
      await act(() => Promise.resolve());
      expect(update()).toBeNull();
    });
  });

  describe("when a part of the app fails to load", () => {
    it("is what the part says, rather than a failure", async () => {
      serveVersion("9.9.9");
      render(<Missing part="editor" />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "DriveMD could not load its editor. Check your connection, then reload it.",
      );

      act(() => {
        window.dispatchEvent(new Event("vite:preloadError"));
      });

      expect(await screen.findByRole("status")).toHaveTextContent(
        "A new version of DriveMD is ready. Reload to open its editor.",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("asks to save first while a note has changes to save", async () => {
      serveVersion("9.9.9");
      render(
        <>
          <Missing part="view of the differences" />
          <Note holding />
        </>,
      );

      act(() => {
        window.dispatchEvent(new Event("vite:preloadError"));
      });

      expect(await screen.findByRole("status")).toHaveTextContent(
        "A new version of DriveMD is ready. Save your changes, then reload to open its view of the differences.",
      );
    });
  });
});
