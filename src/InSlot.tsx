import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SlotsContext, type SlotName } from "./slots.ts";

/**
 * Shows its children in the place of the app bar that the name gives, so
 * that the page that holds their state can stay what owns them. Inside the
 * navigator, it waits for the bar to show that place, since moving them there
 * later would mount them anew; without a bar, it shows them where the page
 * puts them.
 */
export function InSlot({
  name,
  children,
}: {
  name: SlotName;
  children: ReactNode;
}) {
  const slots = useContext(SlotsContext);
  if (!slots) return children;
  const slot = slots[name];
  return slot && createPortal(children, slot);
}
