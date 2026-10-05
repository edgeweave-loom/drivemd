import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { FOLDER, GOOGLE_TYPES, isMarkdown, type FileRef } from "./drive.ts";
import { resolveQuery, vaultLinkQuery } from "./queries.ts";
import { hashOf, onTheWeb, relativePath, type Found } from "./resolve.ts";
import { linkPartHash, showPart } from "./parts.ts";
import { hrefOf, navigate } from "./router.ts";
import type { Vault } from "./vault-settings.ts";

/**
 * Follows a link from the note's source as a tap in the preview would: to a
 * heading of the note, to a web page in a new tab, or where a relative path
 * leads in Drive, as Obsidian finds it in a vault. Call it in the gesture,
 * which renews an expired token.
 */
export function useFollow(
  folder: FileRef | undefined,
  vault: Vault | undefined,
): (href: string) => void {
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
      showPart(href.slice(1));
      return;
    }
    if (onTheWeb(href) || href.startsWith("mailto:")) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const path = relativePath(href);
    if (!path || !folder) return;
    renew();
    const hash = vault ? linkPartHash(hashOf(href)) : hashOf(href);
    // A link not looked up yet is followed if Drive answers within a second,
    // while the click still counts as one: past that, browsers block a new
    // tab, and the user may be elsewhere.
    const clicked = Date.now();
    const reach = (
      known: Found | null | undefined,
      ask: () => Promise<Found | null | undefined>,
    ) => {
      if (known) {
        open(known, hash);
        return;
      }
      ask().then(
        (found) => {
          if (shown.current && Date.now() - clicked < 1_000) open(found, hash);
        },
        () => undefined,
      );
    };
    if (vault) {
      const from = { vault: vault.root, folder };
      const lookup = vaultLinkQuery(drive, client, from, path);
      reach(client.getQueryData(lookup.queryKey)?.found, async () => {
        const { found } = await client.query(lookup);
        return found;
      });
    } else {
      const lookup = resolveQuery(drive, client, folder, path);
      reach(client.getQueryData(lookup.queryKey), () => client.query(lookup));
    }
  };
}

/**
 * Opens what a link leads to in Drive: in the app, a note at the part `hash`
 * names, or in Google Drive.
 */
function open(found: Found | null | undefined, hash: string): void {
  if (!found) return;
  const { ref, name, mimeType } = found;
  if (mimeType === FOLDER) {
    navigate(hrefOf({ name: "folder", folder: ref }));
  } else if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
    navigate(hrefOf({ name: "file", file: ref }) + hash);
  } else {
    window.open(inDrive(ref), "_blank", "noopener,noreferrer");
  }
}
