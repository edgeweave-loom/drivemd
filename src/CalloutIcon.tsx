import type { ReactNode } from "react";
import { ICONS } from "./callout-icons.tsx";
import type { CalloutType } from "./callouts.ts";

/**
 * The icon of a callout's type, drawn in the text's color; its meaning is
 * the title's.
 */
export function CalloutIcon({ type }: { type: CalloutType }) {
  const [name, drawing] = ICONS[type];
  return (
    <Lucide name={name} className="callout-icon">
      {drawing}
    </Lucide>
  );
}

/** A Lucide icon, drawn in the text's color; its meaning is the text's. */
export function Lucide({
  name,
  className,
  children,
}: {
  name: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={`lucide-${name}`}
    >
      {children}
    </svg>
  );
}
