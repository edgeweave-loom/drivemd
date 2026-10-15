import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";
import {
  cycleHeading,
  cycleTask,
  indentLines,
  insertLink,
  outdentLines,
  toggleBold,
  toggleList,
} from "./formatting.ts";
import { keepVisible } from "./visual-viewport.ts";

/** The toolbar's height, which the editor keeps clear of the cursor. */
export const TOOLBAR_HEIGHT = 48;

const KEYS: { name: string; command: Command; icon: IconName }[] = [
  {
    name: "Undo",
    command: undo,
    icon: "undo",
  },
  {
    name: "Redo",
    command: redo,
    icon: "redo",
  },
  {
    name: "Heading",
    command: cycleHeading,
    icon: "title",
  },
  {
    name: "Bold",
    command: toggleBold,
    icon: "format_bold",
  },
  {
    name: "List",
    command: toggleList,
    icon: "format_list_bulleted",
  },
  {
    name: "Checkbox",
    command: cycleTask,
    icon: "check_box",
  },
  {
    name: "Link",
    command: insertLink,
    icon: "link",
  },
  {
    name: "Indent",
    command: indentLines,
    icon: "format_indent_increase",
  },
  {
    name: "Outdent",
    command: outdentLines,
    icon: "format_indent_decrease",
  },
  {
    name: "Find in note",
    command: openSearchPanel,
    icon: "search",
  },
];

/**
 * Keeps the focus, and the keyboard, with the editor. Only the mouse event
 * that would move it is cancelled: WebKit drops a whole tap, click
 * included, when its pointerdown is.
 */
function keepFocus(event: SyntheticEvent) {
  event.preventDefault();
}

/**
 * The formatting keys pinned above a touch screen's keyboard while the
 * editor has the focus: the iPhone's keyboard has no Tab key, nor any key
 * for Markdown. The keys never take the focus, so the keyboard stays. The
 * page's app bar stays on the screen meanwhile, its Done and Save with it.
 */
export function KeyboardToolbar({
  onCommand,
  onResize,
}: {
  onCommand: (command: Command) => void;
  /** Runs once the keyboard has come or gone. */
  onResize: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const resized = useEffectEvent(onResize);
  useLayoutEffect(() => {
    const appBar = document.querySelector<HTMLElement>(".bar");
    const stops = [
      bar.current &&
        keepVisible(bar.current, () => {
          resized();
        }),
      appBar && keepVisible(appBar),
    ];
    return () => {
      for (const stop of stops) stop?.();
    };
  }, []);
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      className="keyboard-toolbar"
    >
      {KEYS.map(({ name, command, icon }) => (
        <button
          key={name}
          type="button"
          aria-label={name}
          onMouseDown={keepFocus}
          onClick={() => {
            onCommand(command);
          }}
        >
          <Icon name={icon} />
        </button>
      ))}
    </div>,
    document.body,
  );
}
