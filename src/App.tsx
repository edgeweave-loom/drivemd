import { useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "./Dialog.tsx";
import { openedFromDrive } from "./drive-tab.ts";
import { Navigator } from "./Navigator.tsx";
import type { Session, SessionState } from "./session.ts";
import { SignOut } from "./SignOut.tsx";

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
          <Navigator
            key={screen.email}
            session={session}
            email={screen.email}
            signedIn={!renewing}
          >
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
                <SignOut account={screen.email} onSignOut={session.signOut} />
                {status}
              </div>
            </Dialog>
          )}
        </>
      );
    }
    case "loading":
      return (
        <SignInCard heading="DriveMD">
          <p>Opening your session…</p>
          {status}
        </SignInCard>
      );
    case "sign-in": {
      // Drive asked for a note, whose name the app cannot know yet.
      const drive = openedFromDrive();
      return (
        <SignInCard
          heading={drive ? "Open a note from Google Drive" : "DriveMD"}
        >
          <p>
            {drive
              ? "Google Drive asked DriveMD to open a Markdown file. Sign in with your Google account to see it."
              : "Browse and edit the Markdown files in your Google Drive."}
          </p>
          <GoogleButton
            google={state.google}
            onClick={session.signIn}
            onRetry={session.retry}
          >
            Sign in with Google
          </GoogleButton>
          {drive && (
            <p className="hint">
              {state.driveAccount
                ? "Google lets you choose the account, starting with the one Drive used."
                : "Google lets you choose the account."}
            </p>
          )}
          {status}
          <p className="about">
            <a href="/about.html">Privacy, terms and support</a>
          </p>
        </SignInCard>
      );
    }
  }
}

/** The screen before sign-in: DriveMD's mark, then what to do. */
function SignInCard({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <main className="app">
      <img className="mark" src="/icon.svg" alt="" />
      <h1>{heading}</h1>
      {children}
    </main>
  );
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
      <button type="button" className="filled" onClick={onRetry}>
        Try again
      </button>
    );
  }
  return (
    <button
      type="button"
      className="filled"
      disabled={google !== "ready"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
