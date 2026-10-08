import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { NameDialog } from "./Dialog.tsx";
import { useDrive } from "./drive-context.ts";
import {
  isMarkdown,
  splitEnding,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { refreshAfterChange } from "./queries.ts";
import { hrefOf, navigate, type Crumb } from "./router.ts";
import { useVaultCheck, vaultNote } from "./vaults.ts";

/**
 * The note's name, as its app bar gives it, with its Markdown ending set
 * apart; when Drive lets the user rename the note, a click on it does, as in
 * Docs.
 */
export function NoteName({
  name,
  file,
  page,
  path,
}: {
  name: string;
  /** The note, once it opens here. */
  file: FileMetadata | undefined;
  /** The file as the page's address names it. */
  page: FileRef;
  path: Crumb[] | undefined;
}) {
  if (!file?.capabilities.canRename) return <Name name={name} />;
  return <Renaming name={name} file={file} page={page} path={path} />;
}

function Name({ name }: { name: string }) {
  const [stem, ending] = splitEnding(name);
  return (
    <>
      {stem}
      <span className="ending">{ending}</span>
    </>
  );
}

/**
 * Renames the file from a field in place of its name: Enter or leaving the
 * field renames it, and Escape leaves it as it was. Outside a vault, the
 * rename goes ahead; otherwise, or while that is not known yet, a dialog asks
 * first, waiting for the vault check, since links to the note in other notes
 * will not follow; it asks again with Drive's reason when Drive refuses.
 */
function Renaming({
  name,
  file,
  page,
  path,
}: {
  name: string;
  file: FileMetadata;
  page: FileRef;
  path: Crumb[] | undefined;
}) {
  const { drive, renew } = useDrive();
  const client = useQueryClient();
  const [typed, setTyped] = useState<string>();
  // The name asked about in the dialog.
  const [asking, setAsking] = useState<string>();
  // The name Drive is given, which shows meanwhile.
  const [giving, setGiving] = useState<string>();
  const button = useRef<HTMLButtonElement>(null);
  // How the field was left: from the keyboard, the focus goes back to the
  // name; Escape renames nothing.
  const leaving = useRef<"enter" | "escape">(undefined);
  const vault = useVaultCheck(
    page,
    typed !== undefined || asking !== undefined,
  );
  const rename = useMutation({
    mutationFn: (to: string) => drive.renameFile(file, to),
    onSuccess: () => {
      refreshAfterChange(client, file);
    },
  });
  const [stem, ending] = splitEnding(file.name);
  const note = vaultNote(vault, "renames");

  const give = (to: string) => {
    setGiving(to);
    // Only while the page shows: Back takes the user elsewhere.
    rename.mutate(to, {
      onSuccess: (renamed) => {
        const href = hrefOf({ name: "file", file: renamed });
        const trail = path?.slice(0, -1);
        navigate(href, trail && [...trail, { name: renamed.name, href }]);
        setAsking(undefined);
      },
      onError: () => {
        setAsking(to);
      },
      onSettled: () => {
        setGiving(undefined);
      },
    });
  };

  const leave = (field: HTMLInputElement) => {
    const how = leaving.current;
    leaving.current = undefined;
    flushSync(() => {
      setTyped(undefined);
    });
    if (how) button.current?.focus();
    const name = field.value.trim();
    // A Markdown ending typed stays as typed, rather than coming twice.
    const to = splitEnding(name)[1] ? name : name + ending;
    if (how === "escape" || name === "" || to === file.name) return;
    rename.reset();
    if (vault === "outside") {
      // Within the tap or the key that renames.
      renew();
      give(to);
    } else setAsking(to);
  };

  return (
    <>
      {typed === undefined ? (
        <button
          ref={button}
          type="button"
          className="note-name"
          title="Rename"
          aria-busy={giving !== undefined}
          onClick={() => {
            // Drive is given a name already.
            if (giving !== undefined) return;
            setTyped(stem);
          }}
        >
          <Name name={giving ?? name} />
        </button>
      ) : (
        <>
          {/* As wide as the name, which the hidden copy after it sets. */}
          <span className="name-field" data-value={typed}>
            <input
              aria-label="Name"
              value={typed}
              // The hidden copy sets the width, not the field's own default.
              size={1}
              // The field takes the place of the name the user clicked.
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key !== "Enter" && event.key !== "Escape") return;
                event.preventDefault();
                leaving.current = event.key === "Enter" ? "enter" : "escape";
                event.currentTarget.blur();
              }}
              onBlur={(event) => {
                // The window losing the focus leaves the field as it is.
                if (!document.hasFocus()) return;
                leave(event.currentTarget);
              }}
            />
          </span>
          <span className="ending">{ending}</span>
        </>
      )}
      {asking !== undefined &&
        // Outside the app bar, whose styles would reach it.
        createPortal(
          <NameDialog
            title="Rename"
            initial={asking}
            hint={(to) =>
              isMarkdown(to.trim())
                ? undefined
                : "Without .md or .markdown at the end, DriveMD will no longer list this file."
            }
            action="Rename"
            pending={rename.isPending}
            ready={vault !== "checking"}
            error={rename.error}
            onSubmit={(to) => {
              renew();
              give(to);
            }}
            onClose={() => {
              setAsking(undefined);
            }}
          >
            {note && (
              <p className={vault === "checking" ? "hint" : "warning"}>
                {note}
              </p>
            )}
          </NameDialog>,
          document.body,
        )}
    </>
  );
}
