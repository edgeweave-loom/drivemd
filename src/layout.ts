import { useSyncExternalStore } from "react";

/** The layouts of the spec's Mobile requirements. */
export type Layout = "phone" | "tablet" | "wide";

// A phone held sideways, wide as it may be, keeps the phone layout.
export const PHONE = "(width < 768px), (pointer: coarse) and (height < 500px)";
export const WIDE = "(width >= 1024px)";
// A screen the user touches, rather than points at with a mouse.
export const TOUCH = "(pointer: coarse)";

function watching(queries: string[]) {
  return (onChange: () => void): (() => void) => {
    const lists = queries.map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener("change", onChange);
    return () => {
      for (const list of lists) list.removeEventListener("change", onChange);
    };
  };
}

const subscribe = watching([PHONE, WIDE]);
const subscribeTouch = watching([TOUCH]);

function current(): Layout {
  if (window.matchMedia(PHONE).matches) return "phone";
  return window.matchMedia(WIDE).matches ? "wide" : "tablet";
}

/** The layout the screen calls for, as it turns or the window resizes. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current);
}

/** Whether the screen is a touch screen, as that changes. */
export function useTouch(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH).matches,
  );
}
