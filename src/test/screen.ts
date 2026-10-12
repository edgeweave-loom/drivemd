import { PHONE, STANDALONE, TOUCH, WIDE, type Layout } from "../layout.ts";

let layout: Layout = "phone";
let touch = false;
let standaloneApp = false;
const listeners = new Set<() => void>();

/** Has the made-up screen call for a layout, as a turn or resize would. */
export function holdScreen(next: Layout): void {
  layout = next;
  for (const listener of listeners) listener();
}

/** Has the made-up screen be a touch screen, or not. */
export function holdTouch(next: boolean): void {
  touch = next;
  for (const listener of listeners) listener();
}

/** Has the made-up screen be the Home Screen app's window, or not. */
export function holdStandaloneApp(next: boolean): void {
  standaloneApp = next;
}

/** jsdom has no media queries: this answers the app's own. */
export function installScreen(): void {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        if (query === TOUCH) return touch;
        if (query === STANDALONE) return standaloneApp;
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

/**
 * Has the browser say whether it runs from the Home Screen, as Safari on an
 * iPhone or an iPad does, or say nothing, as other browsers do.
 */
export function holdStandalone(standalone: boolean | undefined): void {
  if (standalone === undefined) {
    Reflect.deleteProperty(navigator, "standalone");
    return;
  }
  Object.defineProperty(navigator, "standalone", {
    value: standalone,
    configurable: true,
  });
}
