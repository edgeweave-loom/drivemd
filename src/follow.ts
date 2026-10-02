import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { FOLDER, GOOGLE_TYPES, isMarkdown, type FileRef } from "./drive.ts";
import { resolveQuery } from "./queries.ts";
import { onTheWeb, relativePath, type Found } from "./resolve.ts";
import { hrefOf, navigate } from "./router.ts";

/**
 * Follows a link from the note's source as a tap in the preview would: to a
 * heading of the note, to a web page in a new tab, or where a relative path
 * leads in Drive. Call it in the gesture, which renews an expired token.
 */
export function useFollow(folder: FileRef | undefined): (href: string) => void {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  // Whether the note still shows, for a lookup that answers after the click.
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  return (href) => {
    if (href.startsWith("#")) {
      document
        .getElementById(`user-content-${href.slice(1)}`)
        ?.scrollIntoView();
      return;
    }
    if (onTheWeb(href) || href.startsWith("mailto:")) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const path = relativePath(href);
    if (!path || !folder) return;
    renew();
    const lookup = resolveQuery(drive, client, folder, path);
    const known = client.getQueryData(lookup.queryKey);
    if (known !== undefined) {
      open(known);
      return;
    }
    // A link not looked up yet is followed if Drive answers within a second,
    // while the click still counts as one: past that, browsers block a new
    // tab, and the user may be elsewhere.
    const clicked = Date.now();
    client.query(lookup).then(
      (found) => {
        if (shown.current && Date.now() - clicked < 1_000) open(found);
      },
      () => undefined,
    );
  };
}

/** Opens what a link leads to in Drive: in the app, or in Google Drive. */
function open(found: Found | null): void {
  if (!found) return;
  const { ref, name, mimeType } = found;
  if (mimeType === FOLDER) {
    navigate(hrefOf({ name: "folder", folder: ref }));
  } else if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
    navigate(hrefOf({ name: "file", file: ref }));
  } else {
    window.open(inDrive(ref), "_blank", "noopener,noreferrer");
  }
}
