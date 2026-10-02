import { useQueryClient } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { FOLDER, GOOGLE_TYPES, isMarkdown, type FileRef } from "./drive.ts";
import { resolveQuery } from "./queries.ts";
import { onTheWeb, relativePath } from "./resolve.ts";
import { hrefOf, navigate } from "./router.ts";

/**
 * Follows a link from the note's source as a tap in the preview would: to a
 * heading of the note, to a web page in a new tab, or where a relative path
 * leads in Drive. Call it in the gesture, which renews an expired token.
 */
export function useFollow(folder: FileRef | undefined): (href: string) => void {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
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
    client.query(resolveQuery(drive, client, folder, path)).then(
      (found) => {
        if (!found) return;
        const { ref, name, mimeType } = found;
        if (mimeType === FOLDER) {
          navigate(hrefOf({ name: "folder", folder: ref }));
        } else if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
          navigate(hrefOf({ name: "file", file: ref }));
        } else {
          window.open(inDrive(ref), "_blank", "noopener,noreferrer");
        }
      },
      () => undefined,
    );
  };
}
