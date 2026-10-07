import { useLayout } from "./layout.ts";
import { usePlace, type Route } from "./router.ts";

/** The pages that a wide screen shows beside the drawer. */
const BROWSING = new Set<Route["name"]>([
  "home",
  "folder",
  "shortcuts",
  "shared-drives",
  "shared-with-me",
  "search",
]);

/** Whether the page shows beside the drawer, which then holds the roots. */
export function useDrawer(): boolean {
  const { route } = usePlace();
  return useLayout() === "wide" && BROWSING.has(route.name);
}
