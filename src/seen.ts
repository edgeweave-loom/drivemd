import { useCallback, useState } from "react";

/**
 * Whether the element came near the screen, and the ref that watches it.
 * Links and images wait for it before they ask Drive anything, so that a
 * note with thousands of them asks only for those the user scrolls to, and
 * so do the folders of a list's notes.
 */
export function useSeen(): [
  boolean,
  (element: Element | null) => (() => void) | undefined,
] {
  const [seen, setSeen] = useState(false);
  const near = useCallback((element: Element | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        observer.disconnect();
        setSeen(true);
      },
      { rootMargin: "50%" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [seen, near];
}
