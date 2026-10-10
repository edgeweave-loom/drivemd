export type StorageArea = "localStorage" | "sessionStorage";

// Browsers can refuse storage (private modes, blocked site data): a value
// then lives in memory only, as long as the page.
export function read(area: StorageArea, key: string): string | null {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

export function write(
  area: StorageArea,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) window[area].removeItem(key);
    else window[area].setItem(key, value);
  } catch {
    // See read().
  }
}
