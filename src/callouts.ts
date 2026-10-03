import type { Blockquote, Paragraph, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

/** Obsidian's callout types, and the aliases that show as one of them. */
const TYPES = new Map(
  Object.entries({
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
  }).flatMap(([type, names]) => names.map((name) => [name, type])),
);

/** The types a callout shows as, which the sanitizer lets through. */
export const CALLOUT_TYPES = [...new Set(TYPES.values())];

// `[!type]` opens a callout's first line, then `-` or `+` if it folds.
const MARKER = /^\[!([^\]\s]+)\]([+-]?)(?:[ \t]+|(?=\n|$))/;

/**
 * Shows Obsidian's callouts, quotes whose first line starts with `[!type]`,
 * as boxes titled by the rest of that line or else by their type, and that
 * fold when the type ends with `-` (folded) or `+` (open). An unknown type
 * shows as a note.
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
      if (!marker) return;
      const [found, name = "", fold] = marker;
      const [title, body] = firstLine([
        { ...lead, value: lead.value.slice(found.length) },
        ...after,
      ]);
      const blocks = [...(written(body) ? [paragraph(body)] : []), ...rest];
      const content: Blockquote = {
        type: "blockquote",
        children: blocks,
        data: { hName: "div", hProperties: { className: ["callout-content"] } },
      };
      contents.add(content);
      quote.data = {
        hName: fold ? "details" : "div",
        hProperties: {
          className: ["callout"],
          dataCallout: TYPES.get(name.toLowerCase()) ?? "note",
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
            hProperties: { className: ["callout-title"] },
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
    const end = node.type === "text" ? node.value.indexOf("\n") : -1;
    if (node.type === "text" && end >= 0) {
      return [
        [
          ...content.slice(0, index),
          { ...node, value: node.value.slice(0, end) },
        ],
        [
          { ...node, value: node.value.slice(end + 1) },
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
