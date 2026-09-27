import { useSyncExternalStore, type ReactNode } from "react";
import type { Session, SessionState } from "./session.ts";

export function App({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  return (
    <main className="app">
      <h1>DriveMD</h1>
      <Screen session={session} state={state} />
      {state.waiting && (
        <p className="hint">Waiting for Google… Nothing happened? Tap again.</p>
      )}
      {state.message !== undefined && (
        <p role="status" className="message">
          {state.message}
        </p>
      )}
    </main>
  );
}

function Screen({ session, state }: { session: Session; state: SessionState }) {
  const { screen } = state;
  switch (screen.name) {
    case "loading":
      return <p>Opening your session…</p>;
    case "sign-in":
      return (
        <>
          <p>Browse and edit the Markdown files in your Google Drive.</p>
          <GoogleButton
            session={session}
            state={state}
            onClick={session.signIn}
          >
            Sign in with Google
          </GoogleButton>
        </>
      );
    case "continue":
      return (
        <>
          <p>
            Welcome back, <strong>{screen.email}</strong>.
          </p>
          <GoogleButton
            session={session}
            state={state}
            onClick={session.continueSession}
          >
            Continue
          </GoogleButton>
          <button type="button" onClick={session.signOut}>
            Sign out
          </button>
        </>
      );
    case "home":
      return (
        <>
          <p>
            Signed in as <strong>{screen.email}</strong>
          </p>
          <button type="button" onClick={session.signOut}>
            Sign out
          </button>
        </>
      );
  }
}

/** A button that opens Google's popup, usable once Google's script is ready. */
function GoogleButton({
  session,
  state,
  onClick,
  children,
}: {
  session: Session;
  state: SessionState;
  onClick: () => void;
  children: ReactNode;
}) {
  if (state.google === "failed") {
    return (
      <button type="button" className="primary" onClick={session.retry}>
        Try again
      </button>
    );
  }
  return (
    <button
      type="button"
      className="primary"
      disabled={state.google === "loading"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
