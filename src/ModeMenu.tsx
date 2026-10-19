import { useCallback, useId, useRef } from "react";
import type { EditMode } from "./edit-mode.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import { moveInMenu } from "./menu.ts";

/** The note's mode: one of the editor's, or reading it. */
export type Mode = EditMode | "viewing";

interface Choice {
  mode: Mode;
  icon: IconName;
  name: string;
  does: string;
}

const CHOICES: Record<Mode, Choice> = {
  visual: {
    mode: "visual",
    icon: "edit",
    name: "Visual",
    does: "Edit the note as it reads",
  },
  source: {
    mode: "source",
    icon: "code",
    name: "Source",
    does: "Edit the Markdown beside its preview",
  },
  viewing: {
    mode: "viewing",
    icon: "visibility",
    name: "Viewing",
    does: "Save, then read the note",
  },
};

/**
 * The note's mode, as Docs's menu gives it on a wider screen than a phone's:
 * a button naming the mode, and a menu of all three, each saying what it
 * does, the one chosen checked. The focus starts at it, the arrows, Home and
 * End move it, and Tab leaves the menu, which closes.
 */
export function ModeMenu({
  mode,
  onPick,
}: {
  mode: Mode;
  onPick: (mode: Mode) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const current = CHOICES[mode];
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
        onKeyDown={moveInMenu}
      >
        {Object.values(CHOICES).map((choice) => (
          <button
            key={choice.mode}
            type="button"
            role="menuitemradio"
            aria-checked={choice.mode === mode}
            aria-labelledby={`${id}-${choice.mode}`}
            aria-describedby={`${id}-${choice.mode}-does`}
            onClick={() => {
              menu.current?.hidePopover();
              if (choice.mode !== mode) onPick(choice.mode);
            }}
          >
            <Icon name={choice.icon} />
            <span className="mode-label">
              <span id={`${id}-${choice.mode}`}>{choice.name}</span>
              <span id={`${id}-${choice.mode}-does`} className="hint">
                {choice.does}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
