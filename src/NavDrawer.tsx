import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import type { DriveItem } from "./drive.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { Link } from "./Link.tsx";
import { entriesOf } from "./listing.ts";
import { vaultsQuery } from "./queries.ts";
import { ROOTS } from "./roots.ts";
import { hrefOf, usePlace } from "./router.ts";

const ROOT_ICONS: Record<keyof typeof ROOTS, IconName> = {
  myDrive: "cloud",
  shortcuts: "shortcut",
  sharedDrives: "folder_shared",
  sharedWithMe: "group",
};

interface Place {
  key: string;
  name: string;
  href: string;
  icon: IconName;
}

const PLACES: Place[] = [
  { key: "home", name: "Home", href: hrefOf({ name: "home" }), icon: "home" },
  ...Object.entries(ROOTS).map(([key, root]) => ({
    key,
    ...root,
    icon: ROOT_ICONS[key as keyof typeof ROOTS],
  })),
];

const FILLED: Partial<Record<IconName, IconName>> = {
  home: "home_fill",
  cloud: "cloud_fill",
  folder_shared: "folder_shared_fill",
  group: "group_fill",
  book: "book_fill",
};

function vaultEntries(items: DriveItem[]) {
  return entriesOf(items);
}

/**
 * The ways into Drive, beside Home, folders and search on a wide screen, as
 * Google Drive's drawer: its roots, then the Obsidian vaults. The one place
 * the page sits in stands out: the page itself, or else the deepest of the
 * places on the path the user took to it.
 */
export function NavDrawer() {
  const { drive } = useDrive();
  const { href, trail } = usePlace();
  const vaults = useQuery({ ...vaultsQuery(drive), select: vaultEntries });
  const places = [
    ...PLACES,
    ...(vaults.data ?? []).map((vault) => ({
      key: vault.id,
      name: vault.name,
      href: hrefOf({ name: "folder", folder: vault.opens }),
      icon: "book" as const,
    })),
  ];
  const path = [...(trail ?? []).map((crumb) => crumb.href), href].reverse();
  const marked = path
    .map((step) => places.find((place) => place.href === step))
    .find((place) => place !== undefined);
  const item = (place: Place) => {
    const current = place === marked;
    return (
      <li key={place.key}>
        <Link
          to={place.href}
          trail={[{ name: place.name, href: place.href }]}
          current={current && place.href === href}
          aria-current={current ? "true" : undefined}
        >
          <Icon
            name={current ? (FILLED[place.icon] ?? place.icon) : place.icon}
          />
          {place.name}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Drive" className="drawer-nav">
      <ul>{places.slice(0, PLACES.length).map(item)}</ul>
      {vaults.isError && (
        <p className="hint">Google Drive did not list the vaults.</p>
      )}
      {places.length > PLACES.length && (
        <>
          <h2>Vaults</h2>
          <ul>{places.slice(PLACES.length).map(item)}</ul>
        </>
      )}
    </nav>
  );
}
