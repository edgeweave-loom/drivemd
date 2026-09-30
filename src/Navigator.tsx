import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DriveContext } from "./drive-context.ts";
import { FolderPage } from "./FolderPage.tsx";
import { Home } from "./Home.tsx";
import { Link } from "./Link.tsx";
import { createQueryClient } from "./queries.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import { hrefOf, usePlace } from "./router.ts";
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
    case "file":
    case "not-found":
      return <NotFound />;
  }
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
