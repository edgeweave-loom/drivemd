// How many frames to measure again after the visual viewport last moved.
const SETTLE_FRAMES = 30;

/**
 * Keeps a fixed or sticky element within the visual viewport, moving it
 * with a transform: its bottom no lower than the viewport's, and its top no
 * higher, which wins when both cannot hold. With the keyboard up, iOS lays
 * such elements out on the layout viewport, which the keyboard covers, and
 * pans the visual viewport away from its top to show the cursor near the
 * page's end, taking a sticky app bar off the screen.
 *
 * The element's own place is measured rather than taken for the layout
 * viewport's edges, nor is the visual viewport's top taken from
 * `offsetTop`: with the keyboard up, iOS leaves both off by up to hundreds
 * of pixels at the note's end, where typing or deleting lines resizes the
 * page. It also reports passing places as the keyboard comes or goes, then
 * settles without another event, so places are measured again over the
 * next frames (checked in the iOS simulator, in Safari and in the Home
 * Screen app).
 *
 * `below` is an element kept on the screen too, such as the app bar, whose
 * bottom the element's top stays under. `onSettle` runs once the element
 * has settled as it shows, then after each change of the viewport's height,
 * as when the keyboard comes or goes, with the height before: iOS may have
 * brought the keyboard up before the element shows.
 */
export function keepVisible(
  element: HTMLElement,
  {
    below,
    onSettle,
  }: {
    below?: HTMLElement | null;
    onSettle?: (before: number) => void;
  } = {},
): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  let shift = 0;
  let height = viewport.height;
  let settled = false;
  let frames = 0;
  let frame: number | undefined;
  const place = () => {
    const box = element.getBoundingClientRect();
    const offset = viewport.pageTop - window.scrollY;
    // The top is never above the page's, where the Home Screen app puts it
    // a few pixels once the page scrolls to the cursor; the bottom still
    // needs that offset.
    const top = Math.max(0, offset, below?.getBoundingClientRect().bottom ?? 0);
    const bottom = offset + viewport.height;
    shift = Math.round(
      Math.max(
        top - (box.top - shift),
        Math.min(0, bottom - (box.bottom - shift)),
      ),
    );
    // Set through the DOM, which the security policy allows.
    element.style.transform = `translateY(${String(shift)}px)`;
  };
  const settle = () => {
    place();
    frames -= 1;
    frame = frames > 0 ? requestAnimationFrame(settle) : undefined;
    if (frame === undefined && (!settled || viewport.height !== height)) {
      const before = height;
      height = viewport.height;
      settled = true;
      onSettle?.(before);
    }
  };
  const follow = () => {
    place();
    frames = SETTLE_FRAMES;
    frame ??= requestAnimationFrame(settle);
  };
  follow();
  viewport.addEventListener("resize", follow);
  viewport.addEventListener("scroll", follow);
  window.addEventListener("resize", follow);
  window.addEventListener("scroll", follow);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", follow);
    viewport.removeEventListener("scroll", follow);
    window.removeEventListener("resize", follow);
    window.removeEventListener("scroll", follow);
    element.style.transform = "";
  };
}
