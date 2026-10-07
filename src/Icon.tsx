import { ICONS, type IconName } from "./icons.ts";

/** A Material Symbol, drawn in the text's color; its meaning is the label's. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 -960 960 960" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
