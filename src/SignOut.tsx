import { useState } from "react";
import { ConfirmDialog } from "./Dialog.tsx";
import { countDrafts, deleteDrafts } from "./drafts.ts";

/**
 * Signs the account out. Unsaved changes kept on the device go with it, so
 * that nothing of the account stays behind: the user hears how many first,
 * and may stay.
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
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // A device that keeps nothing has nothing to lose.
          countDrafts(account).then((count) => {
            if (count === 0) onSignOut();
            else setUnsaved(count);
          }, onSignOut);
        }}
      >
        Sign out
      </button>
      {unsaved !== undefined && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          action="Discard and sign out"
          pending={pending}
          error={null}
          onConfirm={() => {
            setPending(true);
            void deleteDrafts(account).finally(onSignOut);
          }}
          onClose={() => {
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
