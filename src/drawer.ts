import { useLayout } from "./layout.ts";
import { usePlace, type Route } from "./router.ts";

/** The pages that a wide screen shows beside the drawer or the rail. */
const BROWSING = new Set<Route["name"]>([
  "home",
  "folder",
  "shortcuts",
  "shared-drives",
  "shared-with-me",
  "search",
]);

/**
 * What the page shows beside it, which then holds the roots and the vaults:
 * the navigation drawer on a wide screen, its rail on a tablet, or nothing.
 */
export function useDrawer(): "drawer" | "rail" | undefined {
  const { route } = usePlace();
  const layout = useLayout();
  if (layout === "phone" || !BROWSING.has(route.name)) return undefined;
  return layout === "wide" ? "drawer" : "rail";
}
