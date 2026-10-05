import { useEffect, useState } from "react";
import { getRememberedAccount } from "./auth.ts";
import { hrefOf, mayLeave } from "./router.ts";
import { ConfirmDialog } from "./Dialog.tsx";
import { countDrafts, deleteDrafts } from "./drafts.ts";
import { keepPendingDrafts, resumeKeeping, stopKeeping } from "./keep-draft.ts";

/**
 * Signs the account out. Unsaved changes kept on the device go with it, so
 * that nothing of the account stays behind: the user hears how many first,
 * and may stay. The account another window may have switched to signs out
 * too, so its changes go as well.
 */
export function SignOut({
  account,
  onSignOut,
}: {
  account: string;
  onSignOut: () => void;
}) {
  const [unsaved, setUnsaved] = useState<number>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  // A signed-in account keeps its edits.
  useEffect(() => {
    resumeKeeping();
  }, []);
  const accounts = () => [
    ...new Set([account, getRememberedAccount() ?? account]),
  ];
  const discard = () => Promise.all(accounts().map(deleteDrafts));
  // A note whose changes the device did not keep asks before it goes.
  const leaves = () => {
    if (mayLeave(hrefOf({ name: "home" }))) return true;
    resumeKeeping();
    return false;
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Edits of the last half second count too, and none follow.
          void keepPendingDrafts()
            .then(() => {
              stopKeeping();
              return Promise.all(accounts().map(countDrafts));
            })
            .then(
              (counts) => {
                const count = counts.reduce((sum, one) => sum + one, 0);
                if (count > 0) setUnsaved(count);
                else if (leaves()) onSignOut();
              },
              // Counting failed: what the device may hold goes all the same.
              () => {
                if (leaves()) void discard().then(onSignOut, onSignOut);
              },
            );
        }}
      >
        Sign out
      </button>
      {unsaved !== undefined && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          action="Discard and sign out"
          pending={pending}
          error={failure}
          onConfirm={() => {
            setPending(true);
            setFailure(null);
            discard().then(onSignOut, (error: unknown) => {
              // Signed out, the account would leave them on the device.
              setPending(false);
              setFailure(
                error instanceof Error ? error : new Error(String(error)),
              );
            });
          }}
          onClose={() => {
            resumeKeeping();
            setUnsaved(undefined);
          }}
        >
          <p>
            {unsaved === 1 ? "1 note has" : `${String(unsaved)} notes have`}{" "}
            unsaved changes on this device. Signing out discards them.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
