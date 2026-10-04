import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { DriveContext, useDrive } from "./drive-context.ts";
import { linkedPage } from "./drive-web.ts";
import { FileView } from "./FilePage.tsx";
import { FolderPage } from "./FolderPage.tsx";
import { Home } from "./Home.tsx";
import { Link } from "./Link.tsx";
import { createQueryClient, refreshSearches } from "./queries.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import { hrefOf, mayLeave, navigate, usePlace } from "./router.ts";
import { SearchPage } from "./SearchPage.tsx";
import type { Session } from "./session.ts";
import { SignOut } from "./SignOut.tsx";

const HOME = hrefOf({ name: "home" });

/** The app once signed in: a header, then the page the URL names. */
export function Navigator({
  session,
  email,
  signedIn,
  children,
}: {
  session: Pick<Session, "drive" | "renew" | "signOut">;
  email: string;
  /** Whether Google gave the tab a token for the account yet. */
  signedIn: boolean;
  /** What the session has to say, shown under the header. */
  children?: ReactNode;
}) {
  const [client] = useState(createQueryClient);
  const access = useMemo(
    () => ({
      drive: session.drive,
      renew: session.renew,
      account: email,
      signedIn,
    }),
    [session, email, signedIn],
  );
  return (
    <QueryClientProvider client={client}>
      <DriveContext value={access}>
        <header className="bar">
          <h1>
            <Link to={HOME}>DriveMD</Link>
          </h1>
          <SearchBox />
          <span className="account">{email}</span>
          <SignOut account={email} onSignOut={session.signOut} />
        </header>
        <main className="page">
          {children}
          <Page />
        </main>
      </DriveContext>
    </QueryClientProvider>
  );
}

function Page() {
  const { route, trail } = usePlace();
  switch (route.name) {
    case "home":
      return <Home />;
    case "folder":
      // Each folder and file starts afresh, with no dialog left open.
      return (
        <FolderPage key={route.folder.id} folder={route.folder} trail={trail} />
      );
    case "shortcuts":
      return <ShortcutsPage trail={trail} />;
    case "shared-drives":
      return <SharedDrivesPage trail={trail} />;
    case "shared-with-me":
      return <SharedWithMePage trail={trail} />;
    case "search":
      return <SearchPage text={route.text} />;
    case "file":
      return <FileView file={route.file} trail={trail} />;
    case "not-found":
      return <NotFound />;
  }
}

/**
 * Searches Markdown files by name, from every page, or opens the file or
 * folder of a Drive link pasted in it.
 */
function SearchBox() {
  const { renew } = useDrive();
  const client = useQueryClient();
  const { route } = usePlace();
  const searched = route.name === "search" ? route.text : "";
  const [typed, setTyped] = useState(searched);
  // Another search, from Back or a link, shows its own words.
  const [shown, setShown] = useState(searched);
  if (shown !== searched) {
    setShown(searched);
    setTyped(searched);
  }
  return (
    <form
      role="search"
      className="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim() === "") return;
        const linked = linkedPage(typed);
        const href = linked ?? hrefOf({ name: "search", text: typed });
        // Asked first, so that a refusal opens no Google window.
        if (!mayLeave(href)) return;
        renew();
        navigate(href, undefined, { asked: true });
        if (linked !== undefined) {
          setTyped("");
          return;
        }
        // The same search again asks Drive again.
        refreshSearches(client);
      }}
    >
      <input
        type="search"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        aria-label="Search Markdown files by name"
        placeholder="Search or paste a link"
        enterKeyHint="search"
        autoComplete="off"
      />
    </form>
  );
}

function NotFound() {
  return (
    <>
      <h2>Page not found</h2>
      <p>This address opens nothing in DriveMD.</p>
      <p>
        <Link to={HOME}>Go to Home</Link>
      </p>
    </>
  );
}
