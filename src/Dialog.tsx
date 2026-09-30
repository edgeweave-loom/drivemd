import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { describeError } from "./errors.ts";

/**
 * A modal dialog, open while it is shown: the page behind it is out of
 * reach. Escape closes it, unless it has no onClose.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: (() => void) | undefined;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    // React may run this twice, and a modal dialog cannot open twice.
    if (dialog.current?.open === false) dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="card"
      onCancel={(event) => {
        if (!onClose) event.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

/**
 * Asks for a file's name, then does what `action` names with it. Once asked,
 * Drive does it whatever happens here, so the dialog waits for its answer.
 */
export function NameDialog({
  title,
  initial,
  hint,
  action,
  pending,
  ready = true,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  initial: string;
  /** What to know about the name typed, if anything. */
  hint: (name: string) => string | undefined;
  action: string;
  pending: boolean;
  /** Whether the action may go ahead yet. */
  ready?: boolean;
  error: Error | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
  /** Anything else to know before going ahead. */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial);
  const note = hint(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Typing replaces the name, but not its Markdown ending.
    const end = /\.(md|markdown)$/i.exec(initial)?.index ?? initial.length;
    input.current?.setSelectionRange(0, end);
  }, [initial]);
  return (
    <Dialog title={title} onClose={pending ? undefined : onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <label>
          Name
          <input
            ref={input}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        {note && <p className="hint">{note}</p>}
        {children}
        {error && (
          <p role="alert" className="failure">
            {describeError(error)}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={pending || !ready || name.trim() === ""}
          >
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
