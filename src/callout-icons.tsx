import { Children, isValidElement, type ReactNode } from "react";
import type { CalloutType } from "./callouts.ts";

// Lucide's icons, as lucide-static 1.26.0 draws them, which are the ones
// Obsidian 1.14 gives each type (its stylesheet's --callout-icon) and a
// folding title (chevron-down), by their names in Lucide, prefixed with
// lucide- as Obsidian does. Copyright Lucide Icons and Contributors, under
// the ISC License; check, chevron-down, circle-question-mark, info,
// triangle-alert and x come from Feather, copyright Cole Bemis, under the MIT
// License (LICENSES/Lucide.txt): lucide.dev. Each drawing's shapes take
// their SVG attributes as props, which the editor writes as they are.
export const ICONS: Record<CalloutType, [name: string, drawing: ReactNode]> = {
  note: [
    "pencil",
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>,
  ],
  abstract: [
    "clipboard-list",
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>,
  ],
  info: [
    "info",
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>,
  ],
  todo: [
    "circle-check",
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ],
  tip: [
    "flame",
    <>
      <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
    </>,
  ],
  success: [
    "check",
    <>
      <path d="M20 6 9 17l-5-5" />
    </>,
  ],
  question: [
    "circle-question-mark",
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>,
  ],
  warning: [
    "triangle-alert",
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>,
  ],
  failure: [
    "x",
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
  ],
  danger: [
    "zap",
    <>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </>,
  ],
  bug: [
    "bug",
    <>
      <path d="M12 20v-9" />
      <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
      <path d="M14.12 3.88 16 2" />
      <path d="M21 21a4 4 0 0 0-3.81-4" />
      <path d="M21 5a4 4 0 0 1-3.55 3.97" />
      <path d="M22 13h-4" />
      <path d="M3 21a4 4 0 0 1 3.81-4" />
      <path d="M3 5a4 4 0 0 0 3.55 3.97" />
      <path d="M6 13H2" />
      <path d="m8 2 1.88 1.88" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </>,
  ],
  example: [
    "list",
    <>
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </>,
  ],
  quote: [
    "quote",
    <>
      <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
      <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
    </>,
  ],
};

/** The chevron that ends a folding callout's title. */
export const CHEVRON: [name: string, drawing: ReactNode] = [
  "chevron-down",
  <>
    <path d="m6 9 6 6 6-6" />
  </>,
];

const SVG = "http://www.w3.org/2000/svg";

/**
 * The icon of a callout's type as the viewer's `CalloutIcon` draws it, for
 * the editor, which draws its widgets without React.
 */
export function calloutIcon(type: CalloutType): SVGSVGElement {
  return lucide(ICONS[type], "cm-callout-icon");
}

/** The chevron as the viewer's `CalloutFold` draws it, for the editor. */
export function calloutFold(): SVGSVGElement {
  return lucide(CHEVRON, "cm-callout-chevron");
}

function lucide(
  [name, drawing]: [string, ReactNode],
  className: string,
): SVGSVGElement {
  const icon = document.createElementNS(SVG, "svg");
  for (const [attribute, value] of Object.entries({
    class: className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    "data-icon": `lucide-${name}`,
  })) {
    icon.setAttribute(attribute, value);
  }
  const shapes = isValidElement<{ children: ReactNode }>(drawing)
    ? drawing.props.children
    : null;
  Children.forEach(shapes, (shape) => {
    if (!isValidElement<Record<string, string>>(shape)) return;
    if (typeof shape.type !== "string") return;
    const drawn = document.createElementNS(SVG, shape.type);
    for (const [attribute, value] of Object.entries(shape.props)) {
      drawn.setAttribute(attribute, value);
    }
    icon.append(drawn);
  });
  return icon;
}
