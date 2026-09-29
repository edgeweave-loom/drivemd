import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { Session, SessionState } from "./session.ts";
import { driveItem } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { visit } from "./test/render.tsx";

const EMAIL = "ada@example.com";

function fakeSession(initial: Partial<SessionState> = {}) {
  let state: SessionState = {
    screen: { name: "sign-in" },
    google: "ready",
    waiting: false,
    message: undefined,
    blocked: undefined,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const session = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    signIn: vi.fn(),
    continueSession: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    drive: fakeDrive(),
    renew: vi.fn(),
  } satisfies Session;
  const change = (changes: Partial<SessionState>) => {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  };
  return { session, change };
}

function button(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

describe("App", () => {
  it("shows the app name as the page heading", () => {
    render(<App session={fakeSession().session} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "DriveMD" }),
    ).toBeInTheDocument();
  });

  it("signs in with Google from the Sign in screen", () => {
    const { session } = fakeSession();
    render(<App session={session} />);

    fireEvent.click(button("Sign in with Google"));
    expect(session.signIn).toHaveBeenCalledOnce();
  });

  it("disables Sign in until Google's script is ready", () => {
    render(<App session={fakeSession({ google: "loading" }).session} />);

    expect(button("Sign in with Google")).toBeDisabled();
  });

  it("offers to retry when Google's script failed to load", () => {
    const { session } = fakeSession({
      google: "failed",
      message: "Google sign-in could not load.",
    });
    render(<App session={session} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Google sign-in could not load.",
    );
    fireEvent.click(button("Try again"));
    expect(session.retry).toHaveBeenCalledOnce();
  });

  it("continues or signs out for the remembered account, over the navigator", () => {
    const { session } = fakeSession({
      screen: { name: "continue", email: EMAIL },
    });
    render(<App session={session} />);

    const prompt = within(screen.getByRole("dialog"));
    expect(prompt.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByRole("banner").closest("[inert]")).not.toBeNull();
    fireEvent.click(prompt.getByRole("button", { name: "Continue" }));
    expect(session.continueSession).toHaveBeenCalledOnce();
    fireEvent.click(prompt.getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it("keeps the navigator while the session asks to Continue", () => {
    const { session, change } = fakeSession({
      screen: { name: "home", email: EMAIL },
    });
    render(<App session={session} />);
    const home = screen.getByRole("heading", { name: "Home" });

    act(() => {
      change({ screen: { name: "continue", email: EMAIL } });
    });
    expect(home).toBeInTheDocument();
    act(() => {
      change({ screen: { name: "home", email: EMAIL } });
    });
    expect(home).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(home.closest("[inert]")).toBeNull();
  });

  it("starts afresh when another account continues", () => {
    const { session, change } = fakeSession({
      screen: { name: "continue", email: EMAIL },
    });
    render(<App session={session} />);
    const home = screen.getByRole("heading", { name: "Home" });

    act(() => {
      change({ screen: { name: "home", email: "grace@example.com" } });
    });
    expect(home).not.toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  it("opens the navigator for the signed-in account, which can sign out", () => {
    const { session } = fakeSession({ screen: { name: "home", email: EMAIL } });
    render(<App session={session} />);

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    fireEvent.click(button("Sign out"));
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it("shows another account nothing the first one loaded", async () => {
    visit("/my-drive", { trail: [{ name: "My Drive", href: "/my-drive" }] });
    const { session, change } = fakeSession({
      screen: { name: "home", email: EMAIL },
    });
    session.drive.getMetadata.mockReturnValue(new Promise(() => undefined));
    session.drive.listChildren.mockResolvedValueOnce([driveItem("ada.md")]);
    session.drive.listChildren.mockReturnValueOnce(
      new Promise(() => undefined),
    );
    render(<App session={session} />);
    expect(await screen.findByRole("link", { name: "ada.md" })).toBeVisible();

    act(() => {
      change({ screen: { name: "home", email: "grace@example.com" } });
    });
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ada.md" })).toBeNull();
    visit("/");
  });

  it("offers no action while the session reopens", () => {
    render(
      <App
        session={
          fakeSession({
            screen: { name: "loading", email: EMAIL },
            waiting: true,
          }).session
        }
      />,
    );

    expect(screen.getByText("Opening your session…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Waiting for Google/)).toBeNull();
  });

  it("offers no retry when sign-in is not configured", () => {
    render(
      <App
        session={
          fakeSession({
            google: "unconfigured",
            message: "Sign-in is not configured.",
          }).session
        }
      />,
    );

    expect(button("Sign in with Google")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps the button usable while Google's window is open", () => {
    const { session } = fakeSession({ waiting: true });
    render(<App session={session} />);

    expect(screen.getByText(/Waiting for Google/)).toBeInTheDocument();
    expect(button("Sign in with Google")).toBeEnabled();
  });

  it("offers to renew again from Home when Google's window seems stuck", () => {
    const { session } = fakeSession({
      screen: { name: "home", email: EMAIL },
      waiting: true,
    });
    render(<App session={session} />);

    expect(screen.getByText(/Waiting for Google/)).toBeInTheDocument();
    fireEvent.click(button("Continue"));
    expect(session.renew).toHaveBeenCalledOnce();
  });

  it("shows what the security policy blocked next to the message", () => {
    const blocked =
      "The browser's security policy blocked https://accounts.google.com (script-src-elem).";
    render(
      <App
        session={
          fakeSession({ blocked, message: "Google sign-in could not load." })
            .session
        }
      />,
    );

    expect(
      screen.getAllByRole("status").map((line) => line.textContent),
    ).toEqual(["Google sign-in could not load.", blocked]);
  });

  it("follows the session as it changes", () => {
    const { session, change } = fakeSession();
    render(<App session={session} />);

    act(() => {
      change({ screen: { name: "home", email: EMAIL } });
    });
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });
});
