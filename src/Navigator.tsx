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
import type { FileRef } from "./drive.ts";
import { linkedPage } from "./drive-web.ts";
import { FileView } from "./FilePage.tsx";
import { FolderPage } from "./FolderPage.tsx";
import { Home } from "./Home.tsx";
import { Icon } from "./Icon.tsx";
import { useLayout } from "./layout.ts";
import { Link } from "./Link.tsx";
import { useDrawer } from "./drawer.ts";
import { NavDrawer } from "./NavDrawer.tsx";
import { NewPage } from "./NewPage.tsx";
import { useAbove, useFolder } from "./path.ts";
import { createQueryClient, refreshSearches } from "./queries.ts";
import {
  SharedDrivesPage,
  SharedWithMePage,
  ShortcutsPage,
} from "./RootPages.tsx";
import { ROOT_PLACES } from "./roots.ts";
import {
  getPlace,
  hrefOf,
  mayLeave,
  navigate,
  usePlace,
  type Crumb,
} from "./router.ts";
import { SearchPage } from "./SearchPage.tsx";
import { SlotsContext, type SlotName, type Slots } from "./slots.ts";
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
  // The note's page fills places of the app bar, which it holds the state of.
  const [slots, setSlots] = useState<Slots>({});
  const places = useMemo(() => {
    const place = (name: SlotName) => (element: HTMLElement | null) => {
      setSlots((before) =>
        before[name] === (element ?? undefined)
          ? before
          : { ...before, [name]: element ?? undefined },
      );
    };
    return {
      title: place("title"),
      mode: place("mode"),
      save: place("save"),
      more: place("more"),
    };
  }, []);
  return (
    <QueryClientProvider client={client}>
      <DriveContext value={access}>
        <SlotsContext value={slots}>
          <AppBar email={email} onSignOut={session.signOut} places={places} />
          <Shell>
            {children}
            <Page />
          </Shell>
        </SlotsContext>
      </DriveContext>
    </QueryClientProvider>
  );
}

type Places = Record<SlotName, (element: HTMLElement | null) => void>;

/**
 * DriveMD's mark and name, which lead Home, the search bar and the account.
 * On a phone, the search opens full screen from a button.
 */
function AppBar({
  email,
  onSignOut,
  places,
}: {
  email: string;
  onSignOut: () => void;
  places: Places;
}) {
  const { route } = usePlace();
  if (route.name === "file") {
    return (
      <NoteBar
        file={route.file}
        email={email}
        onSignOut={onSignOut}
        places={places}
      />
    );
  }
  return <BrowsingBar email={email} onSignOut={onSignOut} />;
}

/**
 * A note's app bar: DriveMD's mark, or a phone's way up to the note's
 * folder, then the places the note's page fills, and the account but on a
 * phone, which leaves it to Home.
 */
function NoteBar({
  file,
  email,
  onSignOut,
  places: { title, mode, save, more },
}: {
  file: FileRef;
  email: string;
  onSignOut: () => void;
  places: Places;
}) {
  const { trail } = usePlace();
  const phone = useLayout() === "phone";
  return (
    <header className="bar note">
      {phone ? (
        <NoteUp file={file} trail={trail} />
      ) : (
        <Link to={HOME} className="mark" aria-label="DriveMD">
          <img src="/icon.svg" alt="" />
        </Link>
      )}
      <div className="note-title" ref={title} />
      <div className="note-tools">
        <span className="slot" ref={mode} />
        <span className="slot" ref={save} />
        <span className="slot" ref={more} />
      </div>
      {!phone && <Account email={email} onSignOut={onSignOut} />}
    </header>
  );
}

/**
 * The app bar beside Home, folders and search: DriveMD's mark and name,
 * which lead Home, or on a phone a folder's name and its way up, then the
 * search bar and the account.
 */
function BrowsingBar({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const { route, trail, href } = usePlace();
  const phone = useLayout() === "phone";
  const field = useRef<HTMLInputElement>(null);
  // The page that opened the search, which its Back returns to.
  const opener = useRef<string>(undefined);
  // On a phone, a folder or a root names itself in the bar, with a way up.
  const root =
    phone && route.name !== "folder"
      ? ROOT_PLACES.find((place) => place.root.href === href)?.root
      : undefined;
  const titled = phone && (route.name === "folder" || root !== undefined);
  const looks = route.name === "search" ? "searching" : titled && "titled";
  return (
    <header className={looks ? `bar ${looks}` : "bar"}>
      {route.name === "folder" && titled ? (
        <FolderTitle folder={route.folder} trail={trail} />
      ) : root ? (
        <Title name={root.name} up={[]} />
      ) : (
        <h1>
          <Link to={HOME}>
            <img src="/icon.svg" alt="" />
            DriveMD
          </Link>
        </h1>
      )}
      <SearchBox
        field={field}
        onBack={() => {
          // Home, when the app did not open the search: from a link, a
          // reload, or a Home Screen app that opens on it.
          if (opener.current === undefined) {
            navigate(HOME);
            return;
          }
          opener.current = undefined;
          history.back();
        }}
      />
      <button
        type="button"
        className="icon-button open-search"
        aria-label="Search"
        title="Search"
        onClick={() => {
          const href = hrefOf({ name: "search", text: "" });
          if (!mayLeave(href)) return;
          opener.current = getPlace().href;
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

/** The page, beside the navigation drawer where it shows. */
function Shell({ children }: { children: ReactNode }) {
  const drawer = useDrawer();
  // The page keeps its place whether the drawer shows or not, so that a
  // turn or a resize keeps what it holds.
  return (
    <div className={drawer && `shell ${drawer}`}>
      {drawer && <NavDrawer rail={drawer === "rail"} />}
      <main className={drawer ? "page panel" : "page"}>{children}</main>
    </div>
  );
}

/** A folder's name, from the path the user took or else from Drive. */
function FolderTitle({
  folder,
  trail,
}: {
  folder: FileRef;
  trail: Crumb[] | undefined;
}) {
  const { name } = useFolder(folder, trail);
  return <Title name={name} up={useAbove(folder, trail)} />;
}

/** A note's way up, on a phone: to the folder the path gives it. */
function NoteUp({
  file,
  trail,
}: {
  file: FileRef;
  trail: Crumb[] | undefined;
}) {
  return <Up up={useAbove(file, trail)} />;
}

/** The page's name, and a way up to the place above it. */
function Title({ name, up }: { name: string; up: Crumb[] | undefined }) {
  return (
    <>
      <Up up={up} />
      <h1 className="title">{name}</h1>
    </>
  );
}

/**
 * A way up to the place above the page: the last step of the path that
 * leads there, or else Home; none while the path is unknown.
 */
function Up({ up }: { up: Crumb[] | undefined }) {
  const above = up && (up.at(-1) ?? { name: "Home", href: HOME });
  if (!up || !above) {
    // Its place, kept while the path comes.
    return <span className="icon-button up" />;
  }
  return (
    <Link
      to={above.href}
      trail={up.length > 0 ? up : undefined}
      className="icon-button up"
      aria-label={`Back to ${above.name}`}
      title={`Back to ${above.name}`}
    >
      <Icon name="arrow_back" />
    </Link>
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
function SearchBox({
  field,
  onBack,
}: {
  field: RefObject<HTMLInputElement | null>;
  onBack: () => void;
}) {
  const { renew } = useDrive();
  const client = useQueryClient();
  const { route } = usePlace();
  const phone = useLayout() === "phone";
  const searched = route.name === "search" ? route.text : "";
  const [typed, setTyped] = useState(searched);
  // Another search, from Back or a link, shows its own words, and words
  // typed in a search go with it.
  const page = route.name === "search" ? `search ${route.text}` : "";
  const [shown, setShown] = useState(page);
  if (shown !== page) {
    setShown(page);
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
        navigate(href, undefined, {
          asked: true,
          // A phone's search page shows one search at a time, which its
          // Back leaves at once.
          replace: phone && route.name === "search" && linked === undefined,
        });
        const { route: next } = getPlace();
        const words = next.name === "search" ? next.text : "";
        // A link gives way to the words of the search it opens, if any.
        if (linked !== undefined) setTyped(words);
        // The same search again asks Drive again.
        if (next.name === "search") refreshSearches(client);
      }}
    >
      <button
        type="button"
        className="icon-button back"
        aria-label="Back"
        title="Back"
        onClick={onBack}
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
