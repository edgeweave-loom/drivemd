import { useSyncExternalStore, type ReactNode } from "react";
import type { Session, SessionState } from "./session.ts";

export function App({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  return (
    <main className="app">
      <h1>DriveMD</h1>
      <Screen session={session} state={state} />
      {state.waiting && state.screen.name !== "loading" && (
        <p className="hint">Waiting for Google… Nothing happened? Tap again.</p>
      )}
      {[state.message, state.blocked]
        .filter((line) => line !== undefined)
        .map((line) => (
          <p key={line} role="status" className="message">
            {line}
          </p>
        ))}
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
            google={state.google}
            onClick={session.signIn}
            onRetry={session.retry}
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
            google={state.google}
            onClick={session.continueSession}
            onRetry={session.retry}
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
  google,
  onClick,
  onRetry,
  children,
}: {
  google: SessionState["google"];
  onClick: () => void;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (google === "failed") {
    return (
      <button type="button" className="primary" onClick={onRetry}>
        Try again
      </button>
    );
  }
  return (
    <button
      type="button"
      className="primary"
      disabled={google !== "ready"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
