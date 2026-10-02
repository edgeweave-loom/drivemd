import { useEffect, useEffectEvent, useRef } from "react";
import { deleteDraft, writeDraft, type Draft } from "./drafts.ts";

/** The edits to keep: everything a draft holds but when. */
export type Edits = Omit<Draft, "keptAt">;

/**
 * Keeps the edits on the device as the user types: half a second after the
 * last change, and at once when the page hides or goes, as iOS may close the
 * app without a word. Once nothing is unsaved while the page shows, after a
 * save or edits undone, the device forgets them. A device that keeps nothing
 * still lets the user edit. Returns what forgets a note's edits at once, as
 * when the user discards them.
 */
export function useKeptDraft(
  account: string,
  fileId: string,
  edits: Edits | undefined,
  onForgotten: () => void,
): () => void {
  const pending = useRef<Edits | undefined>(undefined);
  // Whether the device may hold edits from this page.
  const kept = useRef(false);
  const flush = useEffectEvent(() => {
    const due = pending.current;
    pending.current = undefined;
    if (!due) return;
    writeDraft(account, { ...due, keptAt: new Date().toISOString() }).catch(
      () => undefined,
    );
  });
  function forgetNow() {
    pending.current = undefined;
    kept.current = false;
    deleteDraft(account, fileId).catch(() => undefined);
    onForgotten();
  }
  const forget = useEffectEvent(forgetNow);
  useEffect(() => {
    if (!edits) {
      if (kept.current) forget();
      return;
    }
    kept.current = true;
    pending.current = edits;
    const timer = setTimeout(flush, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [edits]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return forgetNow;
}
