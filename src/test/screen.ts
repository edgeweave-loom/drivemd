import { PHONE, WIDE, type Layout } from "../layout.ts";

let layout: Layout = "phone";
const listeners = new Set<() => void>();

/** Has the made-up screen call for a layout, as a turn or resize would. */
export function holdScreen(next: Layout): void {
  layout = next;
  for (const listener of listeners) listener();
}

/** jsdom has no media queries: this answers the app's own. */
export function installScreen(): void {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return query === PHONE
          ? layout === "phone"
          : query === WIDE && layout === "wide";
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    }) as unknown as MediaQueryList;
}
