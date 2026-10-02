import { useId, type ReactNode } from "react";
import { useDrive } from "./drive-context.ts";
import { ItemListing } from "./EntryList.tsx";
import { Link } from "./Link.tsx";
import { recentQuery, vaultsQuery } from "./queries.ts";
import { ROOTS } from "./roots.ts";

export function Home() {
  const { drive } = useDrive();
  return (
    <>
      <h2>Home</h2>
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
              </Link>
            </li>
          ))}
        </ul>
      </Section>
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
