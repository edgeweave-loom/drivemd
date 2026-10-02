import { useEffect, useEffectEvent, useRef } from "react";
import { deleteDraft, writeDraft, type Draft } from "./drafts.ts";

/** The edits to keep: everything a draft holds but when. */
export type Edits = Omit<Draft, "keptAt">;

/**
 * Keeps the edits on the device as the user types: half a second after the
 * last change, and at once when the page hides or goes, as iOS may close the
 * app without a word. A device that keeps nothing still lets the user edit.
 * Returns what forgets a note's edits once saved or dropped.
 */
export function useKeptDraft(
  account: string,
  edits: Edits | undefined,
): (fileId: string) => void {
  const pending = useRef<Edits | undefined>(undefined);
  const flush = useEffectEvent(() => {
    const due = pending.current;
    pending.current = undefined;
    if (!due) return;
    writeDraft(account, { ...due, keptAt: new Date().toISOString() }).catch(
      () => undefined,
    );
  });
  useEffect(() => {
    if (!edits) return;
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
  return (fileId) => {
    pending.current = undefined;
    deleteDraft(account, fileId).catch(() => undefined);
  };
}
