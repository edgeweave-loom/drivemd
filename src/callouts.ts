import type { Blockquote, Paragraph, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";
import { sliceText, writtenAt } from "./written.ts";

/** Obsidian's callout types, and the aliases that show as one of them. */
const ALIASES = {
  note: ["note"],
  abstract: ["abstract", "summary", "tldr"],
  info: ["info"],
  todo: ["todo"],
  tip: ["tip", "hint", "important"],
  success: ["success", "check", "done"],
  question: ["question", "help", "faq"],
  warning: ["warning", "caution", "attention"],
  failure: ["failure", "fail", "missing"],
  danger: ["danger", "error"],
  bug: ["bug"],
  example: ["example"],
  quote: ["quote", "cite"],
};

export type CalloutType = keyof typeof ALIASES;

/** The types a callout shows as, which the sanitizer lets through. */
export const CALLOUT_TYPES = Object.keys(ALIASES) as CalloutType[];

const TYPES = new Map(
  CALLOUT_TYPES.flatMap((type) => ALIASES[type].map((name) => [name, type])),
);

export function isCalloutType(value: unknown): value is CalloutType {
  return typeof value === "string" && Object.hasOwn(ALIASES, value);
}

// `[!type]` opens a callout's first line, then `-` or `+` if it folds.
const MARKER = /^\[!([^\]\s]+)\]([+-]?)(?:[ \t]+|(?=[\r\n]|$))/;
// The note's own line breaks reach the renderer.
const LINE_BREAK = /\r\n?|\n/;

/**
 * Shows Obsidian's callouts, quotes whose first line starts with `[!type]`,
 * as boxes titled by the rest of that line or else by their type, and that
 * fold when the type ends with `-` (folded) or `+` (open). An unknown type
 * shows as a note. It needs remarkEscapes first, which marks an escaped one.
 */
export function remarkCallouts() {
  return (tree: Root) => {
    // A callout's content, which may hold callouts but is none.
    const contents = new WeakSet<Blockquote>();
    visit(tree, "blockquote", (quote) => {
      if (contents.has(quote)) return;
      const [first, ...rest] = quote.children;
      if (first?.type !== "paragraph") return;
      const [lead, ...after] = first.children;
      if (lead?.type !== "text") return;
      const marker = MARKER.exec(lead.value);
      if (!marker || !writtenAt(lead, 0, marker[0].length)) return;
      const [found, name = "", fold] = marker;
      const [title, body] = firstLine([
        sliceText(lead, found.length),
        ...after,
      ]);
      const blocks = [...(written(body) ? [paragraph(body)] : []), ...rest];
      const content: Blockquote = {
        type: "blockquote",
        children: blocks,
        data: { hName: "div", hProperties: { className: ["callout-content"] } },
      };
      contents.add(content);
      const type = TYPES.get(name.toLowerCase()) ?? "note";
      quote.data = {
        hName: fold ? "details" : "div",
        hProperties: {
          className: ["callout"],
          dataCallout: type,
          ...(fold === "+" && { open: true }),
        },
      };
      quote.children = [
        {
          ...paragraph(
            written(title) ? title : [{ type: "text", value: titled(name) }],
          ),
          data: {
            hName: fold ? "summary" : "div",
            // The type again, for the icon the title starts with.
            hProperties: { className: ["callout-title"], dataCallout: type },
          },
        },
        ...(blocks.length > 0 ? [content] : []),
      ];
    });
  };
}

/** The content up to the first line break, and the content after it. */
function firstLine(
  content: PhrasingContent[],
): [PhrasingContent[], PhrasingContent[]] {
  for (const [index, node] of content.entries()) {
    if (node.type === "break") {
      return [content.slice(0, index), content.slice(index + 1)];
    }
    const end = node.type === "text" ? LINE_BREAK.exec(node.value) : null;
    if (node.type === "text" && end) {
      return [
        [...content.slice(0, index), sliceText(node, 0, end.index)],
        [
          sliceText(node, end.index + end[0].length),
          ...content.slice(index + 1),
        ],
      ];
    }
  }
  return [content, []];
}

/** Whether the content shows anything. */
function written(content: PhrasingContent[]): boolean {
  return content.some((node) => node.type !== "text" || node.value !== "");
}

function paragraph(children: PhrasingContent[]): Paragraph {
  return { type: "paragraph", children };
}

/** A type as Obsidian titles it: `WARNING` gives "Warning". */
function titled(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
