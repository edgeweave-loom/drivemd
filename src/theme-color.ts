import { useEffect } from "react";

/**
 * Gives the browser's bars, and the installed app's status bar, the
 * background of a phone's full-screen search while `shown`: they keep the
 * page's otherwise, a band of another color above the search's bar in
 * Android's installed app (seen in the Android Emulator). index.html holds
 * each theme's in the theme-color it changes, as `data-search`.
 */
export function useSearchBars(shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    const metas = [
      ...document.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"][data-search]',
      ),
    ].map((meta) => ({ meta, page: meta.content }));
    for (const { meta } of metas) meta.content = meta.dataset.search ?? "";
    return () => {
      for (const { meta, page } of metas) meta.content = page;
    };
  }, [shown]);
}
