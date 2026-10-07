import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";
import { useDrawer } from "./drawer.ts";
import { useDrive } from "./drive-context.ts";
import { ItemListing } from "./EntryList.tsx";
import { Icon } from "./Icon.tsx";
import { Link } from "./Link.tsx";
import { draftsQuery, recentQuery, vaultsQuery } from "./queries.ts";
import { ROOTS } from "./roots.ts";
import { UnsavedNotes } from "./UnsavedNotes.tsx";

export function Home() {
  const { drive, account, signedIn } = useDrive();
  const drafts = useQuery({ ...draftsQuery(account), enabled: signedIn });
  const drawer = useDrawer();
  return (
    <>
      <h2>Home</h2>
      {drafts.data && drafts.data.length > 0 && (
        <Section title="Unsaved changes">
          <UnsavedNotes drafts={drafts.data} />
        </Section>
      )}
      <Section title="Recent">
        <ItemListing
          query={recentQuery(drive)}
          // Drive sends the file viewed last first.
          order="as-listed"
          // Where a file sits comes from Drive.
          trail={undefined}
          empty="The Markdown files you view, here or in Google Drive, show here."
        />
      </Section>
      {/* The drawer or the rail beside it holds the vaults and the roots. */}
      {drawer === undefined && (
        <>
          <Section title="Vaults">
            <ItemListing
              query={vaultsQuery(drive)}
              trail={undefined}
              empty="No Obsidian vault in your Drive: a vault is a folder with a .obsidian folder in it."
            />
          </Section>
          <Section title="Browse">
            <ul className="entries">
              {Object.values(ROOTS).map((root) => (
                <li key={root.href}>
                  <Link to={root.href} trail={[root]} className="entry folder">
                    {root.name}
                    <Icon name="chevron_right" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}
