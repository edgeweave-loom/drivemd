import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlace,
  guardLeaving,
  hrefOf,
  navigate,
  routeOf,
  usePlace,
  type Route,
} from "./router.ts";

const ID = "1AbC-d_9";
const KEY = "0-kEy_1";
const MY_DRIVE = [{ name: "My Drive", href: "/my-drive" }];

function route(path: string): Route {
  return routeOf(new URL(path, "https://md.example"));
}

function visit(path: string, state: unknown) {
  history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

afterEach(() => {
  guardLeaving(undefined);
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("routes", () => {
  it.each<[string, Exclude<Route, { name: "not-found" }>]>([
    ["/", { name: "home" }],
    ["/my-drive", { name: "folder", folder: { id: "root" } }],
    ["/shortcuts", { name: "shortcuts" }],
    ["/shared-drives", { name: "shared-drives" }],
    ["/shared-with-me", { name: "shared-with-me" }],
    [`/folder/${ID}`, { name: "folder", folder: { id: ID } }],
    [
      `/folder/${ID}?resourcekey=${KEY}`,
      { name: "folder", folder: { id: ID, resourceKey: KEY } },
    ],
    ["/search?q=weekly+plan", { name: "search", text: "weekly plan" }],
    [`/edit?id=${ID}`, { name: "file", file: { id: ID } }],
    [
      `/edit?id=${ID}&resourcekey=${KEY}`,
      { name: "file", file: { id: ID, resourceKey: KEY } },
    ],
  ])("reads and writes %s", (path, expected) => {
    expect(route(path)).toEqual(expected);
    expect(hrefOf(expected)).toBe(path);
  });

  it.each<[string, Route]>([
    ["/search", { name: "search", text: "" }],
    ["/search?q=+weekly%09+plan+", { name: "search", text: "weekly plan" }],
    ["/folder/root", { name: "folder", folder: { id: "root" } }],
    ["/shortcuts/", { name: "shortcuts" }],
    [`/folder/${ID}/`, { name: "folder", folder: { id: ID } }],
  ])("reads %s too", (path, expected) => {
    expect(route(path)).toEqual(expected);
  });

  it.each([
    "/nowhere",
    "/folder",
    "/folder/",
    `/folder/${ID}/more`,
    "/folder/a.b",
    "/folder/a%2Fb",
    "/edit",
    "/edit?id=",
    "/edit?id=a/b",
    `/edit?id=${ID}&resourcekey=a,b`,
    `/folder/${ID}?resourcekey=`,
  ])("finds nothing at %s", (path) => {
    expect(route(path)).toEqual({ name: "not-found" });
  });
});

describe("the place shown", () => {
  it("follows navigation and the back button, with the trail taken", async () => {
    const { result } = renderHook(() => usePlace());
    expect(result.current).toEqual({
      route: { name: "home" },
      href: "/",
      trail: undefined,
      fragment: undefined,
    });

    act(() => {
      navigate("/my-drive", MY_DRIVE);
    });
    expect(window.location.pathname).toBe("/my-drive");
    expect(result.current).toEqual({
      route: { name: "folder", folder: { id: "root" } },
      href: "/my-drive",
      trail: MY_DRIVE,
      fragment: undefined,
    });

    act(() => {
      history.back();
    });
    await waitFor(() => {
      expect(result.current.route).toEqual({ name: "home" });
    });
  });

  it("shows a page opened by a link from its top, but not one Back returns to", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo");

    navigate("/shortcuts");
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);
    navigate("/shortcuts");
    history.back();
    await waitFor(() => {
      expect(getPlace().href).toBe("/");
    });
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it("keeps its snapshot until the location changes", () => {
    const before = getPlace();

    expect(getPlace()).toBe(before);
    navigate("/shortcuts");
    expect(getPlace()).not.toBe(before);
    expect(getPlace().trail).toBeUndefined();
  });

  it("replaces the entry when opening the page already shown", () => {
    navigate("/shortcuts");
    const entries = history.length;

    navigate("/shortcuts", [{ name: "Shortcuts", href: "/shortcuts" }]);
    expect(history.length).toBe(entries);
    expect(getPlace().trail).toEqual([
      { name: "Shortcuts", href: "/shortcuts" },
    ]);
    navigate("/shortcuts");
    expect(getPlace().trail).toEqual([
      { name: "Shortcuts", href: "/shortcuts" },
    ]);
  });

  it("keeps the URL of a page that does not exist", () => {
    visit("/nowhere?x=1", null);

    expect(getPlace()).toEqual({
      route: { name: "not-found" },
      href: "/nowhere?x=1",
      trail: undefined,
      fragment: undefined,
    });
  });

  it("keeps the part of the page a link leads to, after its #", () => {
    navigate(`/edit?id=${ID}#tea`);
    const entries = history.length;

    expect(window.location.hash).toBe("#tea");
    expect(getPlace()).toMatchObject({
      href: `/edit?id=${ID}`,
      fragment: "tea",
    });
    navigate(`/edit?id=${ID}#thé`);
    expect(history.length).toBe(entries);
    expect(getPlace().fragment).toBe("th%C3%A9");
    navigate(`/edit?id=${ID}`);
    expect(getPlace().fragment).toBeUndefined();
  });

  it("knows a page by any of its URLs", () => {
    visit("/folder/root", { trail: MY_DRIVE });
    const entries = history.length;

    expect(getPlace()).toMatchObject({ href: "/my-drive", trail: MY_DRIVE });
    navigate("/my-drive", MY_DRIVE);
    navigate("/folder/root/");
    expect(history.length).toBe(entries);
    expect(window.location.pathname).toBe("/my-drive");
  });

  it.each([
    ["one that leads elsewhere", { trail: MY_DRIVE }],
    ["an empty one", { trail: [] }],
    ["a malformed one", { trail: [{ name: 1, href: "/shortcuts" }] }],
    ["one that is not a list", { trail: "/shortcuts" }],
    ["no state", "/shortcuts"],
    [
      "one through another site",
      {
        trail: [
          { name: "Elsewhere", href: "//evil.example/shortcuts" },
          { name: "Shortcuts", href: "/shortcuts" },
        ],
      },
    ],
    [
      "one through a relative link",
      {
        trail: [
          { name: "Relative", href: "my-drive" },
          { name: "Shortcuts", href: "/shortcuts" },
        ],
      },
    ],
    [
      "one through a link no browser can read",
      {
        trail: [
          { name: "Unreadable", href: "//[" },
          { name: "Shortcuts", href: "/shortcuts" },
        ],
      },
    ],
    [
      "one through a script",
      {
        trail: [
          { name: "Script", href: "javascript:alert(1)" },
          { name: "Shortcuts", href: "/shortcuts" },
        ],
      },
    ],
  ])("ignores a trail that is %s", (_case, state) => {
    visit("/shortcuts", state);

    expect(getPlace().trail).toBeUndefined();
  });
});

describe("leaving a page", () => {
  it("asks the guard where the user goes, and stays when it says no", () => {
    const guard = vi.fn<(to: Route) => boolean>().mockReturnValue(false);
    guardLeaving(guard);

    navigate("/shortcuts");

    expect(guard).toHaveBeenCalledExactlyOnceWith({ name: "shortcuts" });
    expect(getPlace().route).toEqual({ name: "home" });
    guard.mockReturnValue(true);
    navigate("/shortcuts");
    expect(getPlace().route).toEqual({ name: "shortcuts" });
  });

  it("leaves without asking once the user already chose to", () => {
    const guard = vi.fn<(to: Route) => boolean>().mockReturnValue(false);
    guardLeaving(guard);

    navigate("/shortcuts", undefined, { asked: true });

    expect(guard).not.toHaveBeenCalled();
    expect(getPlace().route).toEqual({ name: "shortcuts" });
  });

  it("asks nothing once the guard is gone", () => {
    guardLeaving(() => false);
    guardLeaving(undefined);

    navigate("/shortcuts");

    expect(getPlace().route).toEqual({ name: "shortcuts" });
  });
});
