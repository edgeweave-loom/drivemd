import { useId } from "react";
import { Icon } from "./Icon.tsx";
import { putOff, reload, useNewVersion } from "./new-version.ts";

/**
 * Offers the new version Hosting serves on a banner, once no note has
 * changes to save, until the user reloads or puts it off with Later.
 */
export function NewVersion() {
  const id = useId();
  const version = useNewVersion();
  if (version !== "offered") return null;
  return (
    <section className="banner tip" aria-labelledby={id}>
      <Icon name="refresh" />
      <h3 id={id}>A new version of DriveMD is ready</h3>
      <p>Reload DriveMD to use it.</p>
      <div className="actions">
        <button type="button" className="text" onClick={reload}>
          Reload
        </button>
        <button type="button" className="text" onClick={putOff}>
          Later
        </button>
      </div>
    </section>
  );
}
