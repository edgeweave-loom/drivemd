import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { Link } from "./Link.tsx";
import { entriesOf } from "./listing.ts";
import { vaultsQuery } from "./queries.ts";
import { ROOTS } from "./roots.ts";
import { hrefOf, usePlace } from "./router.ts";

const PLACES: { name: string; href: string; icon: IconName }[] = [
  { name: "Home", href: hrefOf({ name: "home" }), icon: "home" },
  { ...ROOTS.myDrive, icon: "cloud" },
  { ...ROOTS.shortcuts, icon: "shortcut" },
  { ...ROOTS.sharedDrives, icon: "folder_shared" },
  { ...ROOTS.sharedWithMe, icon: "group" },
];

const FILLED: Partial<Record<IconName, IconName>> = {
  home: "home_fill",
  cloud: "cloud_fill",
  folder_shared: "folder_shared_fill",
  group: "group_fill",
  book: "book_fill",
};

/**
 * The ways into Drive, beside Home, folders and search on a wide screen, as
 * Google Drive's drawer: its roots, then the Obsidian vaults. The place the
 * page belongs to stands out, through the path the user took to it.
 */
export function NavDrawer() {
  const { drive } = useDrive();
  const { href, trail } = usePlace();
  const vaults = useQuery({
    ...vaultsQuery(drive),
    select: (items) => entriesOf(items),
  });
  const item = (place: { name: string; href: string; icon: IconName }) => {
    const shown = place.href === href;
    const within = !shown && trail?.some((crumb) => crumb.href === place.href);
    return (
      <li key={place.href}>
        <Link
          to={place.href}
          trail={[{ name: place.name, href: place.href }]}
          current={shown}
          aria-current={within ? "true" : undefined}
        >
          <Icon
            name={
              shown || within ? (FILLED[place.icon] ?? place.icon) : place.icon
            }
          />
          {place.name}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Drive" className="drawer-nav">
      <ul>{PLACES.map(item)}</ul>
      {vaults.data && vaults.data.length > 0 && (
        <>
          <h2>Vaults</h2>
          <ul>
            {vaults.data.map((vault) =>
              item({
                name: vault.name,
                href: hrefOf({ name: "folder", folder: vault.opens }),
                icon: "book",
              }),
            )}
          </ul>
        </>
      )}
    </nav>
  );
}
