import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navigator } from "./Navigator.tsx";
import { getPlace } from "./router.ts";
import { fakeDrive } from "./test/fake-drive.ts";

const EMAIL = "ada@example.com";

function open(path: string) {
  history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const session = { drive: fakeDrive(), renew: vi.fn(), signOut: vi.fn() };
  render(<Navigator session={session} email={EMAIL} />);
  return session;
}

afterEach(() => {
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("Navigator", () => {
  it("shows the account and signs out", () => {
    const session = open("/");

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it("opens on Home, with a way into My Drive", () => {
    open("/");

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "My Drive" }));
    expect(getPlace()).toMatchObject({
      href: "/my-drive",
      trail: [{ name: "My Drive", href: "/my-drive" }],
    });
  });

  it("says when a URL opens nothing, and leads back Home", () => {
    open("/nowhere");

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Go to Home" }));
    expect(getPlace().href).toBe("/");
  });

  it("goes Home from the app's name", () => {
    open("/nowhere");

    fireEvent.click(screen.getByRole("link", { name: "DriveMD" }));
    expect(getPlace().href).toBe("/");
  });
});
