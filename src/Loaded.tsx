import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDrive } from "./drive-context.ts";
import { DriveError } from "./drive.ts";

/**
 * What a Drive query answered, once it has: until then a line saying it is
 * loading, and after a failure what went wrong, with a way to try again.
 */
export function Loaded<T>({
  query,
  missing,
  children,
}: {
  query: UseQueryResult<T>;
  /** What to say when Drive answers that the item is not there. */
  missing: string;
  children: (data: T) => ReactNode;
}) {
  const { renew } = useDrive();
  const failure =
    query.isError &&
    (query.isFetching ? (
      <p className="hint">Trying again…</p>
    ) : (
      <p role="alert" className="failure">
        {describe(query.error, missing)}{" "}
        <button
          type="button"
          onClick={() => {
            renew();
            void query.refetch();
          }}
        >
          Try again
        </button>
      </p>
    ));
  if (query.isLoadingError) return failure;
  if (query.isPending) return <p className="hint">Loading…</p>;
  // A refresh that failed leaves what Drive answered before in view.
  return (
    <>
      {failure}
      {children(query.data)}
    </>
  );
}

function describe(error: Error, missing: string): string {
  if (!(error instanceof DriveError)) return "Something went wrong.";
  if (error.status === 404) return missing;
  if (error.status === 0) return `${error.message}. Check your connection.`;
  return `Google Drive refused the request: ${error.message}`;
}
