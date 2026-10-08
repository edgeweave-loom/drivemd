import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { describeError } from "./errors.ts";

/**
 * A modal dialog, open while it is shown: the page behind it is out of
 * reach. Escape closes it, unless it has no onClose. Once the page drops it,
 * the focus goes back to what had it, if still there, as when it closes.
 */
export function Dialog({
  title,
  className = "card",
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose?: (() => void) | undefined;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element>(null);
  const titleId = useId();
  useEffect(() => {
    // React may run this twice, and a modal dialog cannot open twice.
    if (dialog.current?.open === false) {
      opener.current = document.activeElement;
      dialog.current.showModal();
    }
    return () => {
      const { current } = opener;
      if (current instanceof HTMLElement && current.isConnected) {
        current.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={className}
      // A dialog over this one reaches these handlers too, through React.
      onCancel={(event) => {
        if (event.target === event.currentTarget && !onClose) {
          event.preventDefault();
        }
      }}
      // Escape cannot close it, where browsers know the attribute.
      closedby={onClose ? undefined : "none"}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        if (onClose) {
          onClose();
          return;
        }
        // Elsewhere, browsers let a page refuse Escape once without a tap in
        // between, then close it anyway, with the dialogs under it that
        // cannot close either: they open again, the lowest first.
        for (const closed of document.querySelectorAll<HTMLDialogElement>(
          'dialog[closedby="none"]:not([open])',
        )) {
          closed.showModal();
        }
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

/**
 * Asks before doing what `action` names. Once asked, Drive does it whatever
 * happens here, so the dialog waits for its answer, and says why when Drive
 * refuses.
 */
export function ConfirmDialog({
  title,
  action,
  danger = false,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  action: string;
  /** Whether the action loses something, which then shows as a danger. */
  danger?: boolean;
  pending: boolean;
  error: Error | null;
  /** Does the action; undefined while it may not go ahead yet. */
  onConfirm: (() => void) | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} onClose={pending ? undefined : onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm?.();
        }}
      >
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
            className={danger ? "danger" : "filled"}
            disabled={pending || !onConfirm}
          >
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for a file's name, then does what `action` names with it. */
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
    <ConfirmDialog
      title={title}
      action={action}
      pending={pending}
      error={error}
      onConfirm={
        ready && name.trim() !== ""
          ? () => {
              onSubmit(name);
            }
          : undefined
      }
      onClose={onClose}
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
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      {note && <p className="hint">{note}</p>}
      {children}
    </ConfirmDialog>
  );
}
