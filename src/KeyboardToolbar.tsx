import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { useLayoutEffect, useRef, type SyntheticEvent } from "react";
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
 * Lifts the toolbar so that its bottom meets the visual viewport's, above
 * the keyboard, and keeps it there. The toolbar's own place is measured
 * rather than taken for the layout viewport's bottom edge, nor is the
 * visual viewport's top taken from `offsetTop`: with the keyboard up, iOS
 * leaves both off by up to hundreds of pixels at the note's end, where
 * typing or deleting lines resizes the page (checked in the iOS simulator,
 * in Safari and in the Home Screen app).
 */
function followKeyboard(bar: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  let lift = 0;
  const place = () => {
    const bottom = bar.getBoundingClientRect().bottom + lift;
    const visible = viewport.pageTop - window.scrollY + viewport.height;
    lift = Math.max(0, Math.round(bottom - visible));
    // Set through the DOM, which the security policy allows.
    bar.style.transform = `translateY(${String(-lift)}px)`;
  };
  place();
  viewport.addEventListener("resize", place);
  viewport.addEventListener("scroll", place);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place);
  return () => {
    viewport.removeEventListener("resize", place);
    viewport.removeEventListener("scroll", place);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place);
  };
}

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
 * for Markdown. The keys never take the focus, so the keyboard stays.
 */
export function KeyboardToolbar({
  onCommand,
}: {
  onCommand: (command: Command) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => (bar.current ? followKeyboard(bar.current) : undefined),
    [],
  );
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
