import { useSyncExternalStore } from "react";

/** The layouts of the spec's Mobile requirements. */
export type Layout = "phone" | "tablet" | "wide";

// A phone held sideways, wide as it may be, keeps the phone layout.
export const PHONE = "(width < 768px), (pointer: coarse) and (height < 500px)";
export const WIDE = "(width >= 1024px)";

function subscribe(onChange: () => void): () => void {
  const lists = [PHONE, WIDE].map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function current(): Layout {
  if (window.matchMedia(PHONE).matches) return "phone";
  return window.matchMedia(WIDE).matches ? "wide" : "tablet";
}

/** The layout the screen calls for, as it turns or the window resizes. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current);
}
