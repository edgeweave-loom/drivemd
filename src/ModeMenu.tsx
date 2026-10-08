import { useCallback, useId, useRef } from "react";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";

interface Mode {
  editing: boolean;
  icon: IconName;
  name: string;
  does: string;
}

const EDITING: Mode = {
  editing: true,
  icon: "edit",
  name: "Editing",
  does: "Edit the Markdown beside its preview",
};
const VIEWING: Mode = {
  editing: false,
  icon: "visibility",
  name: "Viewing",
  does: "Save, then read the note",
};

/**
 * The note's mode, as Docs's menu gives it on a wider screen than a phone's:
 * a button naming the mode, and a menu of both, each saying what it does,
 * the one chosen checked. The focus starts at it, the arrows, Home and End
 * move it, and Tab leaves the menu, which closes.
 */
export function ModeMenu({
  editing,
  onPick,
}: {
  editing: boolean;
  onPick: (editing: boolean) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const current = editing ? EDITING : VIEWING;
  // The menu opens at the mode chosen.
  const holding = useCallback((element: HTMLDivElement | null) => {
    menu.current = element;
    if (!element) return;
    const opened = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      element.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    };
    element.addEventListener("toggle", opened);
    return () => {
      element.removeEventListener("toggle", opened);
      menu.current = null;
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="tonal mode"
        popoverTarget={id}
        aria-haspopup="menu"
      >
        <Icon name={current.icon} />
        {current.name}
        <Icon name="arrow_drop_down" />
      </button>
      <div
        ref={holding}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Mode"
        className="menu mode-menu"
        onKeyDown={(event) => {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              '[role="menuitemradio"]',
            ),
          ];
          if (event.key === "Tab") {
            event.currentTarget.hidePopover();
            return;
          }
          const at = items.indexOf(event.target as HTMLElement);
          const to = {
            ArrowDown: (at + 1) % items.length,
            ArrowUp: (at - 1 + items.length) % items.length,
            Home: 0,
            End: items.length - 1,
          }[event.key];
          if (to === undefined) return;
          event.preventDefault();
          items[to]?.focus();
        }}
      >
        {[EDITING, VIEWING].map((mode) => (
          <button
            key={mode.name}
            type="button"
            role="menuitemradio"
            aria-checked={mode.editing === editing}
            aria-labelledby={`${id}-${mode.name}`}
            aria-describedby={`${id}-${mode.name}-does`}
            onClick={() => {
              menu.current?.hidePopover();
              if (mode.editing !== editing) onPick(mode.editing);
            }}
          >
            <Icon name={mode.icon} />
            <span className="mode-label">
              <span id={`${id}-${mode.name}`}>{mode.name}</span>
              <span id={`${id}-${mode.name}-does`} className="hint">
                {mode.does}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
