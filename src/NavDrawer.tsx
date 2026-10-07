import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { useDrive } from "./drive-context.ts";
import type { DriveItem } from "./drive.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { Link } from "./Link.tsx";
import { entriesOf } from "./listing.ts";
import { vaultsQuery } from "./queries.ts";
import { ROOT_PLACES } from "./roots.ts";
import { hrefOf, usePlace } from "./router.ts";

interface Place {
  key: string;
  name: string;
  href: string;
  icon: IconName;
}

const PLACES: Place[] = [
  { key: "home", name: "Home", href: hrefOf({ name: "home" }), icon: "home" },
  ...ROOT_PLACES.map(({ root, icon }) => ({
    key: root.href,
    ...root,
    icon,
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
 * The ways into Drive, beside Home, folders and search, as Google Drive's
 * drawer on a wide screen: its roots, then the Obsidian vaults. On a tablet,
 * its rail holds the same roots, and the vaults behind one item. The one
 * place the page sits in stands out: the page itself, or else the deepest
 * of the places on the path the user took to it.
 */
export function NavDrawer({ rail = false }: { rail?: boolean }) {
  const { drive } = useDrive();
  const { href, trail } = usePlace();
  const vaults = useQuery({ ...vaultsQuery(drive), select: vaultEntries });
  const menu = useId();
  const popover = useRef<HTMLDivElement>(null);
  const vaultPlaces: Place[] = (vaults.data ?? []).map((vault) => ({
    key: vault.id,
    name: vault.name,
    href: hrefOf({ name: "folder", folder: vault.opens }),
    icon: "book",
  }));
  const places = [...PLACES, ...vaultPlaces];
  // The menu goes once a vault opens, and stays when the user stays.
  useEffect(() => {
    const shown = popover.current;
    if (shown?.matches(":popover-open")) shown.hidePopover();
  }, [href]);
  const path = [...(trail ?? []).map((crumb) => crumb.href), href].reverse();
  const marked = path
    .map((step) => places.find((place) => place.href === step))
    .find((place) => place !== undefined);
  const looks = (icon: IconName, current: boolean) => (
    <span className="indicator">
      <Icon name={current ? (FILLED[icon] ?? icon) : icon} />
    </span>
  );
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
          {looks(place.icon, current)}
          {place.name}
        </Link>
      </li>
    );
  };
  const failed = vaults.isError && (
    <p className="hint">Google Drive did not list the vaults.</p>
  );
  if (rail) {
    const inVault = marked !== undefined && vaultPlaces.includes(marked);
    return (
      <nav aria-label="Drive" className="drawer-nav rail">
        <ul>{PLACES.map(item)}</ul>
        {(vaultPlaces.length > 0 || failed) && (
          <>
            <button
              type="button"
              className="vaults"
              popoverTarget={menu}
              aria-current={inVault ? "true" : undefined}
            >
              {looks("book", inVault)}
              Vaults
            </button>
            <div
              ref={popover}
              id={menu}
              popover="auto"
              role="dialog"
              aria-label="Vaults"
              className="menu vaults-menu"
            >
              {failed}
              <ul>{vaultPlaces.map(item)}</ul>
            </div>
          </>
        )}
      </nav>
    );
  }
  return (
    <nav aria-label="Drive" className="drawer-nav">
      <ul>{PLACES.map(item)}</ul>
      {failed}
      {vaultPlaces.length > 0 && (
        <>
          <h2>Vaults</h2>
          <ul>{vaultPlaces.map(item)}</ul>
        </>
      )}
    </nav>
  );
}
