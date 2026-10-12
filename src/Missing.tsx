import { reload, useNewVersion } from "./new-version.ts";

/**
 * Says that a part of the app could not load, with a way to reload it:
 * because a new version replaced it, when Hosting serves one, after the
 * note's changes are saved, or else because of the connection.
 */
export function Missing({ part }: { part: string }) {
  const version = useNewVersion();
  const replaced = version !== "none";
  const why =
    version === "none"
      ? `DriveMD could not load its ${part}. Check your connection, then reload it.`
      : version === "waiting"
        ? `A new version of DriveMD is ready. Save your changes, then reload to open its ${part}.`
        : `A new version of DriveMD is ready. Reload to open its ${part}.`;
  return (
    <p
      role={replaced ? "status" : "alert"}
      className={replaced ? undefined : "failure"}
    >
      {why}{" "}
      <button type="button" onClick={reload}>
        Reload
      </button>
    </p>
  );
}
