import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveContext } from "./drive-context.ts";
import { markTab } from "./drive-tab.ts";
import { Link } from "./Link.tsx";
import { getPlace, hrefOf } from "./router.ts";
import { openNoteTabs } from "./test/note-tab.ts";
import { fakeDrive } from "./test/fake-drive.ts";

const TRAIL = [{ name: "My Drive", href: "/my-drive" }];

function renderLink(renew = vi.fn(), to = "/my-drive") {
  render(
    <DriveContext
      value={{
        drive: fakeDrive(),
        renew,
        signOut: vi.fn(),
        account: "ada@example.com",
        signedIn: true,
      }}
    >
      <Link to={to} trail={TRAIL}>
        My Drive
      </Link>
    </DriveContext>,
  );
  return screen.getByRole("link", { name: "My Drive" });
}

afterEach(() => {
  vi.restoreAllMocks();
  markTab(false);
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("Link", () => {
  it("renews the token within the tap, then opens the page", () => {
    const renew = vi.fn(() => {
      expect(window.location.pathname).toBe("/");
    });
    const link = renderLink(renew);

    expect(link).toHaveAttribute("href", "/my-drive");
    expect(fireEvent.click(link)).toBe(false);
    expect(renew).toHaveBeenCalledOnce();
    expect(getPlace()).toMatchObject({ href: "/my-drive", trail: TRAIL });
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("leaves a click with %o to the browser", (options) => {
    const renew = vi.fn();
    const link = renderLink(renew);
    link.addEventListener("click", (event) => {
      // jsdom cannot open another tab or window.
      event.preventDefault();
    });

    fireEvent.click(link, options);
    expect(renew).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("needs the signed-in user's Drive", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Link to="/my-drive">My Drive</Link>)).toThrow(
      /DriveContext/,
    );
  });
});

describe("A link to another note, in a tab opened from Drive", () => {
  const SHOWN = hrefOf({ name: "file", file: { id: "plan" } });
  const OTHER = hrefOf({ name: "file", file: { id: "notes" } });

  function fromDrive() {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { type: "navigate" } as PerformanceNavigationTiming,
    ]);
    markTab(true);
    history.replaceState(null, "", SHOWN);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  it("opens it in a new tab, before anything else can spend the tap", () => {
    fromDrive();
    const { open } = openNoteTabs();
    const renew = vi.fn();
    const link = renderLink(renew, OTHER);

    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledOnce();
    expect(renew).not.toHaveBeenCalled();
    expect(getPlace().href).toBe(SHOWN);
  });

  it("opens it in place when the browser blocks the new tab", () => {
    fromDrive();
    vi.spyOn(window, "open").mockReturnValue(null);
    const renew = vi.fn();
    const link = renderLink(renew, OTHER);

    fireEvent.click(link);
    expect(renew).toHaveBeenCalledOnce();
    expect(getPlace().href).toBe(OTHER);
  });
});
