import type {
  FootnoteDefinition,
  Nodes,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import {
  findAndReplace,
  type RegExpMatchObject,
} from "mdast-util-find-and-replace";
import { visit } from "unist-util-visit";
import { sliceText, writtenAt } from "./written.ts";

/** Where a mark such as `==` starts, in a text among some content. */
interface Place {
  node: number;
  offset: number;
}

/**
 * The places where the pattern matches in the content's own text, where the
 * note writes the mark as it is.
 */
function marks(content: PhrasingContent[], pattern: RegExp): Place[] {
  return content.flatMap((node, index) =>
    node.type === "text"
      ? [...node.value.matchAll(pattern)]
          .filter((match) => writtenAt(node, match.index, match[0].length))
          .map((match) => ({ node: index, offset: match.index }))
      : [],
  );
}

/** Just after a mark of the given length. */
function after({ node, offset }: Place, length: number): Place {
  return { node, offset: offset + length };
}

/** The content from one place up to another, or to its end. */
function range(
  content: PhrasingContent[],
  from: Place,
  to: Place = { node: content.length, offset: 0 },
): PhrasingContent[] {
  const parts: PhrasingContent[] = [];
  for (let index = from.node; index < content.length; index += 1) {
    const node = content[index];
    if (!node || index > to.node) break;
    if (node.type !== "text") {
      // A place in another node stands just before it.
      if (index < to.node) parts.push(node);
      continue;
    }
    const start = index === from.node ? from.offset : 0;
    const end = index === to.node ? to.offset : node.value.length;
    if (start === 0 && end === node.value.length) parts.push(node);
    else if (start < end) parts.push(sliceText(node, start, end));
  }
  return parts;
}

/** Whether the content shows anything but spaces. */
function written(content: PhrasingContent[]): boolean {
  return content.some((node) => node.type !== "text" || /\S/.test(node.value));
}

/** The nodes whose children are Markdown text: paragraphs, headings... */
function holdsText(
  node: Nodes,
): node is Extract<Parents, { children: PhrasingContent[] }> {
  return [
    "paragraph",
    "heading",
    "tableCell",
    "emphasis",
    "strong",
    "delete",
    "link",
    "linkReference",
  ].includes(node.type);
}

/** The nodes whose children are blocks: quotes, list items... */
function holdsBlocks(
  node: Nodes,
): node is Extract<Parents, { children: RootContent[] }> {
  return ["root", "blockquote", "listItem", "footnoteDefinition"].includes(
    node.type,
  );
}

const COMMENT = /%%/g;

/**
 * Hides Obsidian's comments, `%%text%%`: within a paragraph, or from a `%%`
 * to the next one across blocks, or to the end of the quote, list item or
 * note when none closes it. Code shows them as written.
 */
export function remarkComments() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type === "heading" || node.type === "tableCell") {
        [node.children] = uncommented(node.children);
      } else if (holdsBlocks(node)) {
        node.children = uncommentedBlocks(node.children);
      }
    });
  };
}

/** The blocks without their comments, which may span several of them. */
function uncommentedBlocks<Block extends RootContent>(
  blocks: Block[],
): Block[] {
  let open = false;
  return blocks.flatMap((block) => {
    if (block.type !== "paragraph") return open ? [] : [block];
    let content = block.children;
    if (open) {
      const [close] = marks(content, COMMENT);
      if (!close) return [];
      content = range(content, after(close, 2));
    }
    [content, open] = uncommented(content);
    return written(content) ? [{ ...block, children: content }] : [];
  });
}

/** The content without its comments, and whether the last one is open. */
function uncommented(content: PhrasingContent[]): [PhrasingContent[], boolean] {
  const found = marks(content, COMMENT);
  const parts: PhrasingContent[] = [];
  let from: Place = { node: 0, offset: 0 };
  for (let index = 0; index + 1 < found.length; index += 2) {
    const [open, close] = [found[index], found[index + 1]];
    if (!open || !close) break;
    parts.push(...range(content, from, open));
    from = after(close, 2);
  }
  const left = found.length % 2 === 1 ? found.at(-1) : undefined;
  parts.push(...range(content, from, left));
  return [parts, left !== undefined];
}

// Two = only: a longer run is no mark.
const HIGHLIGHT = /(?<!=)==(?!=)/g;

/**
 * Shows Obsidian's highlights, `==text==`, marked. As with emphasis, the
 * opening `==` comes before text and the closing one after it.
 */
export function remarkHighlights() {
  return (tree: Root) => {
    highlight(tree);
  };
}

function highlight(node: Nodes): void {
  if (!("children" in node)) return;
  for (const child of node.children) highlight(child);
  if (holdsText(node)) node.children = highlighted(node.children);
}

function highlighted(content: PhrasingContent[]): PhrasingContent[] {
  const parts: PhrasingContent[] = [];
  let from: Place = { node: 0, offset: 0 };
  let open: Place | undefined;
  for (const mark of marks(content, HIGHLIGHT)) {
    if (!open) {
      if (/\S/.test(next(content, after(mark, 2)))) open = mark;
    } else if (/\S/.test(previous(content, mark))) {
      parts.push(...range(content, from, open), {
        type: "emphasis",
        children: range(content, after(open, 2), mark),
        data: { hName: "mark" },
      });
      from = after(mark, 2);
      open = undefined;
    }
  }
  parts.push(...range(content, from));
  return parts;
}

/** The character after a place, or a letter for another node there. */
function next(content: PhrasingContent[], { node, offset }: Place): string {
  const here = content[node];
  const character = here?.type === "text" ? here.value.charAt(offset) : "";
  if (character !== "") return character;
  return shownAt(content[node + 1], (value) => value.charAt(0));
}

/** The character before a place, or a letter for another node there. */
function previous(content: PhrasingContent[], { node, offset }: Place): string {
  const here = content[node];
  if (here?.type === "text" && offset > 0) return here.value.charAt(offset - 1);
  return shownAt(content[node - 1], (value) => value.slice(-1));
}

/** A neighbor's character next to a place: none at a line break. */
function shownAt(
  node: PhrasingContent | undefined,
  character: (value: string) => string,
): string {
  if (!node || node.type === "break") return "";
  return node.type === "text" ? character(node.value) : "x";
}

const INLINE_NOTE = /\^\[/g;

/**
 * Shows Obsidian's inline footnotes, `^[text]`, as footnotes, in their turn
 * among the note's others. A link's text holds none, as a link holds no link.
 */
export function remarkInlineFootnotes() {
  return (tree: Root) => {
    const taken = new Set<string>();
    visit(tree, "footnoteDefinition", ({ identifier }) => {
      taken.add(identifier);
    });
    const definitions: FootnoteDefinition[] = [];
    let count = 0;
    const define = (content: PhrasingContent[]) => {
      let identifier;
      do {
        count += 1;
        identifier = `inline-${String(count)}`;
      } while (taken.has(identifier));
      definitions.push({
        type: "footnoteDefinition",
        identifier,
        children: [{ type: "paragraph", children: content }],
      });
      return identifier;
    };
    footnote(tree, define);
    tree.children.push(...definitions);
  };
}

function footnote(
  node: Nodes,
  define: (content: PhrasingContent[]) => string,
): void {
  if (!("children" in node) || node.type === "link") return;
  if (node.type === "linkReference") return;
  for (const child of node.children) footnote(child, define);
  if (holdsText(node)) node.children = withNotes(node.children, define);
}

function withNotes(
  content: PhrasingContent[],
  define: (content: PhrasingContent[]) => string,
): PhrasingContent[] {
  const parts: PhrasingContent[] = [];
  let from: Place = { node: 0, offset: 0 };
  for (const open of marks(content, INLINE_NOTE)) {
    // A `^[` within a note is part of its text.
    if (
      open.node < from.node ||
      (open.node === from.node && open.offset < from.offset)
    ) {
      continue;
    }
    const close = closing(content, after(open, 2));
    if (!close) break;
    const identifier = define(range(content, after(open, 2), close));
    parts.push(...range(content, from, open), {
      type: "footnoteReference",
      identifier,
      label: identifier,
    });
    from = after(close, 1);
  }
  parts.push(...range(content, from));
  return parts;
}

/** The `]` that closes a bracket open before a place, among written ones. */
function closing(content: PhrasingContent[], from: Place): Place | undefined {
  let depth = 1;
  for (let index = from.node; index < content.length; index += 1) {
    const node = content[index];
    if (node?.type !== "text") continue;
    const start = index === from.node ? from.offset : 0;
    for (let offset = start; offset < node.value.length; offset += 1) {
      const character = node.value.charAt(offset);
      if (
        (character !== "[" && character !== "]") ||
        !writtenAt(node, offset, 1)
      ) {
        continue;
      }
      depth += character === "[" ? 1 : -1;
      if (depth === 0) return { node: index, offset };
    }
  }
  return undefined;
}

// Letters, digits, `_`, `-` and `/`, as Obsidian allows them in a tag.
const TAG = /#([\p{L}\p{M}\p{N}_/-]+)/gu;

/**
 * Shows Obsidian's tags, `#tag` and `#parent/child`, as labels. A tag starts
 * a line or follows a space, and holds more than digits. It runs last: the
 * texts it splits lose what the note escapes in them.
 */
export function remarkTags() {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        TAG,
        (
          whole: string,
          name: string,
          { index, input, stack }: RegExpMatchObject,
        ) => {
          const node = stack.at(-1);
          const before =
            index > 0
              ? input.charAt(index - 1)
              : shownAt(siblingBefore(stack), (value) => value.slice(-1));
          if (
            node?.type !== "text" ||
            !writtenAt(node, index, 1) ||
            /\S/.test(before) ||
            /^\p{N}+$/u.test(name)
          ) {
            return false;
          }
          return {
            type: "text",
            value: whole,
            data: { hName: "span", hProperties: { className: ["tag"] } },
          };
        },
      ],
      // A link shows its text, and its address is no place for a tag.
      { ignore: ["link", "linkReference"] },
    );
  };
}

/** The node before the text a match is in, if any. */
function siblingBefore(
  stack: RegExpMatchObject["stack"],
): PhrasingContent | undefined {
  const [parent, node] = stack.slice(-2);
  if (!parent || !node || !("children" in parent)) return;
  const siblings: Nodes[] = parent.children;
  const sibling = siblings[siblings.indexOf(node) - 1];
  return sibling && isPhrasing(sibling) ? sibling : undefined;
}

function isPhrasing(node: Nodes): node is PhrasingContent {
  return node.type === "text" || node.type === "break" || !holdsBlocks(node);
}

// `^id` ends a block: letters, digits and dashes, after a space.
const BLOCK_ID = /(?:^|\s+)\^([A-Za-z0-9-]+)$/;

/**
 * Hides Obsidian's block IDs, `^id` at the end of a paragraph or on a line of
 * its own after a block, and names that block with them, or the list item
 * whose text they end.
 */
export function remarkBlockIds() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (holdsBlocks(node)) node.children = named(node, node.children);
    });
  };
}

function named<Block extends RootContent>(
  container: Nodes,
  blocks: Block[],
): Block[] {
  return blocks.flatMap((block, index) => {
    const last = block.type === "paragraph" ? block.children.at(-1) : undefined;
    const found = last?.type === "text" ? BLOCK_ID.exec(last.value) : null;
    if (block.type !== "paragraph" || last?.type !== "text" || !found) {
      return [block];
    }
    const id = `^${found[1] ?? ""}`;
    const caret = found.index + found[0].length - id.length;
    if (!writtenAt(last, caret, 1)) return [block];
    const value = sliceText(last, 0, found.index);
    if (block.children.length > 1 || value.value !== "") {
      block.children[block.children.length - 1] = value;
      // The first paragraph of a list item is the item's own text.
      const item = container.type === "listItem" && index === 0;
      nameBlock(item ? container : block, id);
      return [block];
    }
    // On a line of its own, the ID names the block before.
    const before = blocks[index - 1];
    if (!before) return [block];
    nameBlock(before, id);
    return [];
  });
}

function nameBlock(block: Nodes, id: string): void {
  block.data = {
    ...block.data,
    hProperties: { ...block.data?.hProperties, id },
  };
}
