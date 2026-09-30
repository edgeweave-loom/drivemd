import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveContext } from "./drive-context.ts";
import { Link } from "./Link.tsx";
import { getPlace } from "./router.ts";
import { fakeDrive } from "./test/fake-drive.ts";

const TRAIL = [{ name: "My Drive", href: "/my-drive" }];

function renderLink(renew = vi.fn()) {
  render(
    <DriveContext value={{ drive: fakeDrive(), renew }}>
      <Link to="/my-drive" trail={TRAIL}>
        My Drive
      </Link>
    </DriveContext>,
  );
  return screen.getByRole("link", { name: "My Drive" });
}

afterEach(() => {
  vi.restoreAllMocks();
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
