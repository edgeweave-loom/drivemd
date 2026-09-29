import { useId, type ReactNode } from "react";
import { useDrive } from "./drive-context.ts";
import { ItemListing } from "./EntryList.tsx";
import { Link } from "./Link.tsx";
import { ROOTS } from "./roots.ts";

// Vaults seldom come and go, and finding them takes a call per vault.
const VAULTS_STALE_TIME = 5 * 60_000;

export function Home() {
  const { drive } = useDrive();
  return (
    <>
      <h2>Home</h2>
      <Section title="Recent">
        <ItemListing
          queryKey={["recent"]}
          list={drive.listRecent}
          // Drive sends the file viewed last first.
          order="as-listed"
          // Where a file sits comes from Drive.
          trail={undefined}
          empty="The Markdown files you view, here or in Google Drive, show here."
        />
      </Section>
      <Section title="Vaults">
        <ItemListing
          queryKey={["vaults"]}
          list={drive.findVaults}
          staleTime={VAULTS_STALE_TIME}
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
