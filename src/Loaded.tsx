import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDrive } from "./drive-context.ts";
import { describeError } from "./errors.ts";

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
  missing?: string | undefined;
  children: (data: T) => ReactNode;
}) {
  const { renew } = useDrive();
  const failure =
    query.isError &&
    (query.isFetching ? (
      <p className="hint">Trying again…</p>
    ) : (
      <p role="alert" className="failure">
        {describeError(query.error, missing)}{" "}
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
