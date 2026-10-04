import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { useDrive } from "./drive-context.ts";
import { ItemListing } from "./EntryList.tsx";
import { searchQuery } from "./queries.ts";

/** Markdown files by name, in every drive, the latest changed first. */
export function SearchPage({ text }: { text: string }) {
  const words = text === "" ? [] : text.split(" ");
  const wanted =
    words.length === 1
      ? `a word starting with “${text}”`
      : `words starting with ${words.map((word) => `“${word}”`).join(" and ")}`;
  return (
    <>
      <Breadcrumbs path={undefined} />
      <h2>{text === "" ? "Search" : `Search: ${text}`}</h2>
      {text === "" ? (
        <p className="hint">Type words from a file's name to find it.</p>
      ) : (
        <Results text={text} wanted={wanted} />
      )}
    </>
  );
}

/** What Drive found, saying when it left some drives out. */
function Results({ text, wanted }: { text: string; wanted: string }) {
  const { drive } = useDrive();
  const search = searchQuery(drive, text);
  const incomplete = useQuery({
    ...search,
    select: (found) => found.incomplete,
  });
  return (
    <>
      {incomplete.data && (
        <p className="hint">
          Google Drive did not search every drive, so some matches may be
          missing.
        </p>
      )}
      <ItemListing
        query={{ ...search, select: (found) => found.items }}
        order="as-listed"
        // Where a file sits comes from Drive, not from the search.
        trail={undefined}
        empty={`Among Drive's first 100 matches, no Markdown file has a name with ${wanted}. Drive matches the start of words: “plan” finds planning.md, not myplan.md.`}
      />
    </>
  );
}
