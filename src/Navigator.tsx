import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DriveContext, useDrive } from "./drive-context.ts";
import { FilePage } from "./FilePage.tsx";
import { FolderPage } from "./FolderPage.tsx";
import { Home } from "./Home.tsx";
import { Link } from "./Link.tsx";
import { createQueryClient } from "./queries.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import { hrefOf, navigate, usePlace } from "./router.ts";
import { SearchPage } from "./SearchPage.tsx";
import type { Session } from "./session.ts";

const HOME = hrefOf({ name: "home" });

/** The app once signed in: a header, then the page the URL names. */
export function Navigator({
  session,
  email,
  inert = false,
  children,
}: {
  session: Pick<Session, "drive" | "renew" | "signOut">;
  email: string;
  /** Whether the navigator is out of reach, behind a prompt. */
  inert?: boolean;
  /** What the session has to say, shown under the header. */
  children?: ReactNode;
}) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <DriveContext value={session}>
        <div className="shell" inert={inert}>
          <header className="bar">
            <h1>
              <Link to={HOME}>DriveMD</Link>
            </h1>
            <SearchBox />
            <span className="account">{email}</span>
            <button type="button" onClick={session.signOut}>
              Sign out
            </button>
          </header>
          <main className="page">
            {children}
            <Page />
          </main>
        </div>
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
      return <FolderPage folder={route.folder} trail={trail} />;
    case "shortcuts":
      return <ShortcutsPage trail={trail} />;
    case "shared-drives":
      return <SharedDrivesPage trail={trail} />;
    case "shared-with-me":
      return <SharedWithMePage trail={trail} />;
    case "search":
      return <SearchPage text={route.text} />;
    case "file":
      return <FilePage file={route.file} trail={trail} />;
    case "not-found":
      return <NotFound />;
  }
}

/** Searches Markdown files by name, from every page. */
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
        renew();
        navigate(hrefOf({ name: "search", text: typed }));
        // The same search again asks Drive again.
        void client.invalidateQueries({ queryKey: ["search"] });
      }}
    >
      <input
        type="search"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        aria-label="Search Markdown files by name"
        placeholder="Search"
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
