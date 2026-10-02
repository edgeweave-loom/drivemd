import { useEffect, useEffectEvent, useRef } from "react";
import { signedOutElsewhere } from "./auth.ts";
import { deleteDraft, writeDraft, type Draft } from "./drafts.ts";

/** The edits to keep: everything a draft holds but when. */
export type Edits = Omit<Draft, "keptAt">;

// What writes each open note's pending edits at once.
const keepers = new Set<() => Promise<void>>();

// While the account signs out, it keeps nothing more on the device, even
// what an open note was about to keep as it goes.
let stopped = false;

/** Writes every open note's edits still waiting their half second. */
export async function keepPendingDrafts(): Promise<void> {
  await Promise.all([...keepers].map((keep) => keep()));
}

/** Keeps nothing more on the device: the account signs out. */
export function stopKeeping(): void {
  stopped = true;
}

/** Keeps edits again: an account is signed in, or stays so. */
export function resumeKeeping(): void {
  stopped = false;
}

window.addEventListener("storage", (event) => {
  if (signedOutElsewhere(event)) stopKeeping();
});

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
  const keep = useRef<() => Promise<void>>(() => Promise.resolve());
  // Whether the device may hold edits from this page.
  const kept = useRef(false);
  function forgetNow() {
    pending.current = undefined;
    kept.current = false;
    deleteDraft(account, fileId).catch(() => undefined);
    onForgotten();
  }
  const forget = useEffectEvent(forgetNow);
  useEffect(() => {
    const write = async () => {
      // Stopped, the edits wait: the user may yet stay signed in.
      const due = pending.current;
      if (!due || stopped) return;
      pending.current = undefined;
      await writeDraft(account, {
        ...due,
        keptAt: new Date().toISOString(),
      }).catch(() => undefined);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void write();
    };
    const leaving = () => {
      void write();
    };
    keep.current = write;
    keepers.add(write);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      keepers.delete(write);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      void write();
    };
  }, [account]);
  useEffect(() => {
    if (!edits) {
      if (kept.current) forget();
      return;
    }
    kept.current = true;
    pending.current = edits;
    const timer = setTimeout(() => {
      void keep.current();
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [edits]);
  return forgetNow;
}
