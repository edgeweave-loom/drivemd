import { useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "./Dialog.tsx";
import { Navigator } from "./Navigator.tsx";
import type { Session, SessionState } from "./session.ts";

export function App({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { screen } = state;
  const status = <Status session={session} state={state} />;

  switch (screen.name) {
    case "home":
    case "continue": {
      const renewing = screen.name === "continue";
      // Continue shows over the navigator, which keeps its pages and what they
      // loaded; another account gets a navigator of its own, with nothing
      // cached.
      return (
        <>
          <Navigator key={screen.email} session={session} email={screen.email}>
            {!renewing && status}
          </Navigator>
          {renewing && (
            // Over any other dialog; Escape does not dismiss it.
            <Dialog title="Welcome back">
              <div className="stack">
                <p>
                  Continue as <strong>{screen.email}</strong>.
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
                {status}
              </div>
            </Dialog>
          )}
        </>
      );
    }
    case "loading":
    case "sign-in":
      return (
        <main className="app">
          <h1>DriveMD</h1>
          {screen.name === "loading" ? (
            <p>Opening your session…</p>
          ) : (
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
          )}
          {status}
        </main>
      );
  }
}

/** What the session has to say: a sign-in under way, messages. */
function Status({ session, state }: { session: Session; state: SessionState }) {
  return (
    <>
      {state.waiting && state.screen.name !== "loading" && (
        <p className="hint">
          Waiting for Google… Nothing happened?{" "}
          {state.screen.name === "home" ? (
            // Home has no sign-in button to tap again.
            <button type="button" onClick={session.renew}>
              Continue
            </button>
          ) : (
            "Tap again."
          )}
        </p>
      )}
      {[state.message, state.blocked]
        .filter((line) => line !== undefined)
        .map((line) => (
          <p key={line} role="status" className="message">
            {line}
          </p>
        ))}
    </>
  );
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
