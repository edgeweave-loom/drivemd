import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { Account } from "./Account.tsx";
import { DriveContext, useDrive } from "./drive-context.ts";
import { linkedPage } from "./drive-web.ts";
import { FileView } from "./FilePage.tsx";
import { FolderPage } from "./FolderPage.tsx";
import { Home } from "./Home.tsx";
import { Icon } from "./Icon.tsx";
import { Link } from "./Link.tsx";
import { NewPage } from "./NewPage.tsx";
import { createQueryClient, refreshSearches } from "./queries.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import { getPlace, hrefOf, mayLeave, navigate, usePlace } from "./router.ts";
import { SearchPage } from "./SearchPage.tsx";
import type { Session } from "./session.ts";

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
        <AppBar email={email} onSignOut={session.signOut} />
        <main className="page">
          {children}
          <Page />
        </main>
      </DriveContext>
    </QueryClientProvider>
  );
}

/**
 * DriveMD's mark and name, which lead Home, the search bar and the account.
 * On a phone, the search opens full screen from a button.
 */
function AppBar({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const { route } = usePlace();
  const field = useRef<HTMLInputElement>(null);
  return (
    <header className={route.name === "search" ? "bar searching" : "bar"}>
      <h1>
        <Link to={HOME}>
          <img src="/icon.svg" alt="" />
          DriveMD
        </Link>
      </h1>
      <SearchBox field={field} />
      <button
        type="button"
        className="icon-button open-search"
        aria-label="Search"
        title="Search"
        onClick={() => {
          const href = hrefOf({ name: "search", text: "" });
          if (!mayLeave(href)) return;
          // At once, so that the field takes the focus within the tap,
          // which alone brings up a phone's keyboard.
          flushSync(() => {
            navigate(href, undefined, { asked: true });
          });
          field.current?.focus();
        }}
      >
        <Icon name="search" />
      </button>
      <Account email={email} onSignOut={onSignOut} />
    </header>
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
    case "new":
      return <NewPage folder={route.folder} />;
    case "share":
      return <NothingShared />;
    case "not-found":
      return <NotFound />;
  }
}

/**
 * Searches Markdown files by name, from every page, or opens the file or
 * folder of a Drive link pasted in it.
 */
function SearchBox({ field }: { field: RefObject<HTMLInputElement | null> }) {
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
        const { route } = getPlace();
        const words = route.name === "search" ? route.text : "";
        // A link gives way to the words of the search it opens, if any.
        if (linked !== undefined) setTyped(words);
        // The same search again asks Drive again.
        if (route.name === "search") refreshSearches(client);
      }}
    >
      <button
        type="button"
        className="icon-button back"
        aria-label="Back"
        title="Back"
        onClick={() => {
          history.back();
        }}
      >
        <Icon name="arrow_back" />
      </button>
      <Icon name="search" />
      <input
        ref={field}
        type="search"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        aria-label="Search Markdown files by name"
        placeholder="Search or paste a link"
        enterKeyHint="search"
        autoComplete="off"
        // Phones would capitalize or correct the words of a file's name.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {typed !== "" && (
        <button
          type="button"
          className="icon-button clear"
          aria-label="Clear"
          title="Clear"
          onClick={() => {
            setTyped("");
            field.current?.focus();
          }}
        >
          <Icon name="close" />
        </button>
      )}
    </form>
  );
}

function NothingShared() {
  return (
    <>
      <h2>Nothing to open</h2>
      <p>
        DriveMD opens links to Google Drive files and folders, and to its own
        pages.
      </p>
      <p>
        <Link to={HOME}>Go to Home</Link>
      </p>
    </>
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
