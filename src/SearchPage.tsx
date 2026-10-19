import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import { ItemListing } from "./EntryList.tsx";
import { useLayout } from "./layout.ts";
import { entriesOf } from "./listing.ts";
import { searchQuery } from "./queries.ts";

/** Markdown files by name, in every drive, the latest changed first. */
export function SearchPage({ text }: { text: string }) {
  return (
    <>
      <h2>{text === "" ? "Search" : `Results for “${text}”`}</h2>
      {text === "" ? (
        <p className="hint">Type words from a file's name to find it.</p>
      ) : (
        <Results text={text} />
      )}
    </>
  );
}

/**
 * What Drive found, saying how names match, and when it left some drives
 * out: above the results on a wider screen, under them on a phone, where
 * the line also says that a Drive link opens.
 */
function Results({ text }: { text: string }) {
  const { drive } = useDrive();
  const phone = useLayout() === "phone";
  const search = searchQuery(drive, text);
  const incomplete = useQuery({
    ...search,
    select: (found) => found.incomplete,
  });
  const found = useQuery({
    ...search,
    select: (found) => entriesOf(found.items).length > 0,
  });
  const words = text.split(" ").map((word) => `“${word}”`);
  const quoted = words.join(" and ");
  const one = words.length === 1;
  const matched =
    found.data &&
    (phone ? (
      <p className="hint matched">
        Names with {one ? "a word that starts" : "words that start"} with{" "}
        {quoted}. Paste a Drive link to open it.
      </p>
    ) : (
      <p className="hint matched">
        Markdown files with {one ? "a word" : "words"} in their name that{" "}
        {one ? "starts" : "start"} with {quoted}, most recently modified first.
      </p>
    ));
  return (
    <>
      {!phone && matched}
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
        located
        empty={`Among Drive's first 100 matches, no Markdown file has a name with ${one ? "a word starting with" : "words starting with"} ${quoted}. Drive matches the start of words: “plan” finds planning.md, not myplan.md.`}
      />
      {phone && matched}
    </>
  );
}
