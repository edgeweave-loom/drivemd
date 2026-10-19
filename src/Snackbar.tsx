import { useEffect, useState } from "react";

/** How long a snackbar shows (docs/DESIGN.md, Snackbar). */
export const SHOWN_FOR = 4000;

/**
 * A short sentence at the screen's bottom, which a screen reader hears: it
 * shows again each time `times` grows, and goes after a few seconds. The
 * place that says it stays, so that what comes into it is announced.
 */
export function Snackbar({
  times,
  message,
}: {
  /** How many times the page has had it to say. */
  times: number;
  message: string;
}) {
  return (
    <div className="snackbars" role="status">
      {times > 0 && <Message key={times}>{message}</Message>}
    </div>
  );
}

function Message({ children }: { children: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setGone(true);
    }, SHOWN_FOR);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return gone ? null : <p className="snackbar">{children}</p>;
}
