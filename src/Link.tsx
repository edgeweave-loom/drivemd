import type { MouseEvent, ReactNode } from "react";
import { useDrive } from "./drive-context.ts";
import { navigate, type Crumb } from "./router.ts";

/**
 * A link to a page of the app. A plain tap renews an expired token before
 * anything else, since Google's popup needs the tap, then opens the page;
 * a click that opens a new tab or window is left to the browser.
 */
export function Link({
  to,
  trail,
  className,
  current = false,
  children,
}: {
  to: string;
  /** The path the user takes by following the link, for the breadcrumbs. */
  trail?: Crumb[] | undefined;
  className?: string;
  /** Whether the link leads to the page shown. */
  current?: boolean;
  children: ReactNode;
}) {
  const { renew } = useDrive();
  function open(event: MouseEvent<HTMLAnchorElement>) {
    const { button, metaKey, ctrlKey, shiftKey, altKey } = event;
    if (button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return;
    event.preventDefault();
    renew();
    navigate(to, trail);
  }
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={open}
    >
      {children}
    </a>
  );
}
