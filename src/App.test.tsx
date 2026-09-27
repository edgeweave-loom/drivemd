import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { Session, SessionState } from "./session.ts";

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

  it("continues or signs out for the remembered account", () => {
    const { session } = fakeSession({
      screen: { name: "continue", email: EMAIL },
    });
    render(<App session={session} />);

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    fireEvent.click(button("Continue"));
    expect(session.continueSession).toHaveBeenCalledOnce();
    fireEvent.click(button("Sign out"));
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it("shows the signed-in account and signs out", () => {
    const { session } = fakeSession({ screen: { name: "home", email: EMAIL } });
    render(<App session={session} />);

    expect(screen.getByText(/Signed in as/)).toHaveTextContent(
      `Signed in as ${EMAIL}`,
    );
    fireEvent.click(button("Sign out"));
    expect(session.signOut).toHaveBeenCalledOnce();
  });

  it("offers no action while the session reopens", () => {
    render(
      <App
        session={
          fakeSession({ screen: { name: "loading" }, waiting: true }).session
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
    expect(screen.getByText(/Signed in as/)).toHaveTextContent(EMAIL);
  });
});
