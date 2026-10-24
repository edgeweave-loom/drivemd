import { vi } from "vitest";

/** The empty tab that window.open gives, which the app then sends on. */
export function blankTab() {
  const replace = vi.fn<(url: string | URL) => void>();
  return { tab: { location: { replace } } as unknown as Window, replace };
}
