import type {
  FootnoteDefinition,
  Nodes,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
  Text,
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
 * Where a mark stands in a text, written as it is, and as `accept` says. A
 * mark the note escapes is none, but the next character may start one.
 */
function marksIn(
  node: Text,
  mark: string,
  accept: (offset: number) => boolean = () => true,
): number[] {
  const offsets: number[] = [];
  let at = node.value.indexOf(mark);
  while (at >= 0) {
    const found = writtenAt(node, at, mark.length) && accept(at);
    if (found) offsets.push(at);
    at = node.value.indexOf(mark, at + (found ? mark.length : 1));
  }
  return offsets;
}

/** Where a mark stands in the content's own texts, in order. */
function marks(
  content: PhrasingContent[],
  mark: string,
  accept: (node: Text, offset: number) => boolean = () => true,
): Place[] {
  const places: Place[] = [];
  for (const [index, node] of content.entries()) {
    if (node.type !== "text") continue;
    for (const offset of marksIn(node, mark, (at) => accept(node, at))) {
      places.push({ node: index, offset });
    }
  }
  return places;
}

/** Just after a mark of the given length. */
function after({ node, offset }: Place, length: number): Place {
  return { node, offset: offset + length };
}

/** Adds the content from one place up to another, or to its end, to `parts`. */
function range(
  parts: PhrasingContent[],
  content: PhrasingContent[],
  from: Place,
  to: Place = { node: content.length, offset: 0 },
): PhrasingContent[] {
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

/**
 * Hides Obsidian's comments: what lies between a `%%` and the next one, in
 * the note's order, whatever blocks it spans, and from a last `%%` to the end
 * of the note. A block it hides as a whole goes. Code shows them as written.
 */
export function remarkComments() {
  return (tree: Root) => {
    uncomment(tree, { open: false });
  };
}

/**
 * Takes out of a node what comments hide, the comment open or not as the
 * note's order reaches it; whether anything of the node is left.
 */
function uncomment(node: Nodes, comment: { open: boolean }): boolean {
  if (!("children" in node)) return !comment.open;
  const kept: RootContent[] = [];
  let changed = false;
  for (const child of node.children) {
    if (child.type === "text") {
      const parts = uncommentText(child, comment);
      changed ||= parts.length !== 1 || parts[0] !== child;
      for (const part of parts) kept.push(part);
    } else if (uncomment(child, comment)) {
      kept.push(child);
    } else {
      changed = true;
    }
  }
  if (!changed) return true;
  Object.assign(node, { children: kept });
  if (holdsText(node)) trim(node.children);
  // A table keeps its shape, and goes only when nothing of it is left.
  if (node.type === "tableCell" || node.type === "tableRow") return true;
  if (node.type === "table") {
    return node.children.some((row) =>
      row.children.some((cell) => cell.children.length > 0),
    );
  }
  return node.children.length > 0;
}

/** The parts of a text outside comments, the comment open or not after it. */
function uncommentText(node: Text, comment: { open: boolean }): Text[] {
  const parts: Text[] = [];
  let from = 0;
  for (const at of marksIn(node, "%%")) {
    if (!comment.open && at > from) parts.push(sliceText(node, from, at));
    comment.open = !comment.open;
    from = at + 2;
  }
  if (from === 0) return comment.open ? [] : [node];
  if (!comment.open && from < node.value.length) {
    parts.push(sliceText(node, from));
  }
  return parts;
}

/**
 * Takes off the spaces and line breaks a comment left at either end of some
 * text, as Markdown takes them off a paragraph's.
 */
function trim(content: PhrasingContent[]): void {
  while (content[0]?.type === "break") content.shift();
  while (content.at(-1)?.type === "break") content.pop();
  const [first] = content;
  if (first?.type === "text") {
    content[0] = sliceText(
      first,
      first.value.length - first.value.trimStart().length,
    );
  }
  const last = content.at(-1);
  if (last?.type === "text") {
    content[content.length - 1] = sliceText(
      last,
      0,
      last.value.trimEnd().length,
    );
  }
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const node = content[index];
    if (node?.type === "text" && node.value === "") content.splice(index, 1);
  }
}

/**
 * Shows Obsidian's highlights, `==text==`, marked. As with emphasis, the
 * opening `==` comes before text and the closing one after it, and a longer
 * run of `=` is no mark.
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
  const found = marks(content, "==", (node, offset) =>
    // An `=` the note escapes is no part of the run.
    [offset - 1, offset + 2].every(
      (at) => node.value.charAt(at) !== "=" || !writtenAt(node, at, 1),
    ),
  );
  if (found.length < 2) return content;
  const parts: PhrasingContent[] = [];
  let from: Place = { node: 0, offset: 0 };
  let open: Place | undefined;
  for (const mark of found) {
    if (!open) {
      if (/\S/.test(next(content, after(mark, 2)))) open = mark;
    } else if (/\S/.test(previous(content, mark))) {
      range(parts, content, from, open);
      parts.push({
        type: "emphasis",
        children: range([], content, after(open, 2), mark),
        data: { hName: "mark" },
      });
      from = after(mark, 2);
      open = undefined;
    }
  }
  return range(parts, content, from);
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

/**
 * Shows Obsidian's inline footnotes, `^[text]`, as footnotes, in their turn
 * among the note's others. A link's text holds none, as a link holds no link.
 */
export function remarkInlineFootnotes() {
  return (tree: Root) => {
    // The names the note gives its own footnotes, even hidden ones.
    const taken = new Set<string>();
    visit(tree, ["footnoteDefinition", "footnoteReference"], (node) => {
      if ("identifier" in node) taken.add(node.identifier);
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
    // Added once all are found, so that a note's own text holds none.
    for (const definition of definitions) tree.children.push(definition);
  };
}

function footnote(
  node: Nodes,
  define: (content: PhrasingContent[]) => string,
): void {
  if (!("children" in node) || node.type === "link") return;
  if (node.type === "linkReference") return;
  // The notes a text holds first: what lies in one, emphasis included, goes
  // with it and holds no other.
  if (holdsText(node)) node.children = withNotes(node.children, define);
  for (const child of node.children) footnote(child, define);
}

function withNotes(
  content: PhrasingContent[],
  define: (content: PhrasingContent[]) => string,
): PhrasingContent[] {
  const found = marks(content, "^[");
  if (found.length === 0) return content;
  const closes = closings(content);
  const parts: PhrasingContent[] = [];
  let from: Place = { node: 0, offset: 0 };
  for (const open of found) {
    // A `^[` within a note is part of its text.
    if (
      open.node < from.node ||
      (open.node === from.node && open.offset < from.offset)
    ) {
      continue;
    }
    const close = closes.get(`${String(open.node)}:${String(open.offset + 1)}`);
    if (!close) continue;
    const identifier = define(range([], content, after(open, 2), close));
    range(parts, content, from, open);
    parts.push({ type: "footnoteReference", identifier, label: identifier });
    from = after(close, 1);
  }
  return range(parts, content, from);
}

/**
 * Where each written `[` of the content's texts is closed, by the place of
 * the `[`: found in one pass, so that a `[` never closed costs nothing more.
 */
function closings(content: PhrasingContent[]): Map<string, Place> {
  const closes = new Map<string, Place>();
  const open: Place[] = [];
  for (const [index, node] of content.entries()) {
    if (node.type !== "text") continue;
    for (let offset = 0; offset < node.value.length; offset += 1) {
      const character = node.value.charAt(offset);
      if (character !== "[" && character !== "]") continue;
      if (!writtenAt(node, offset, 1)) continue;
      if (character === "[") {
        open.push({ node: index, offset });
        continue;
      }
      const opened = open.pop();
      if (opened) {
        closes.set(`${String(opened.node)}:${String(opened.offset)}`, {
          node: index,
          offset,
        });
      }
    }
  }
  return closes;
}

// Letters, digits, `_`, `-` and `/`, as Obsidian allows them in a tag, after
// a space or at the start of the text.
const TAG = /(?<!\S)#([\p{L}\p{M}\p{N}_/-]+)/gu;

/**
 * Shows Obsidian's tags, `#tag` and `#parent/child`, as labels. A tag starts
 * a line or follows a space, and holds more than digits. It comes last of the
 * plugins that read escapes: the texts it splits lose them.
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
  if (!parent || node?.type !== "text" || !holdsText(parent)) return;
  return parent.children[parent.children.indexOf(node) - 1];
}

const BLOCK_NAME = /^[A-Za-z0-9-]+$/;

/**
 * Hides Obsidian's block IDs, `^id` after a space at the end of a paragraph,
 * or on a line of its own, and names with them that paragraph, the list item
 * whose text it is, or the block before a line of its own. A heading keeps
 * its name, which links give by its text.
 */
export function remarkBlockIds() {
  return (tree: Root) => {
    nameBlocks(tree);
  };
}

/** Names the blocks under a node, a list's items too, but not text. */
function nameBlocks(node: Nodes): void {
  if (!("children" in node) || holdsText(node)) return;
  if (holdsBlocks(node)) node.children = named(node, node.children);
  for (const child of node.children) nameBlocks(child);
}

function named<Block extends RootContent>(
  container: Nodes,
  blocks: Block[],
): Block[] {
  const kept: Block[] = [];
  for (const [index, block] of blocks.entries()) {
    const found = block.type === "paragraph" && blockId(block.children);
    const before = kept.at(-1);
    if (!found) {
      kept.push(block);
    } else if (found.alone) {
      // On a line of its own, the ID names the block before.
      if (!before) kept.push(block);
      else if (before.type !== "heading") nameBlock(before, found.id);
    } else {
      // The first paragraph of a list item is the item's own text.
      const item = container.type === "listItem" && index === 0;
      nameBlock(item ? container : block, found.id);
      kept.push(block);
    }
  }
  return kept;
}

/**
 * The block ID ending a paragraph's text, and whether it was all the text;
 * a line of its own keeps it until the block before takes it.
 */
function blockId(
  content: PhrasingContent[],
): { id: string; alone: boolean } | undefined {
  const last = content.at(-1);
  if (last?.type !== "text") return;
  const at = last.value.lastIndexOf("^");
  const name = last.value.slice(at + 1);
  if (at < 0 || !BLOCK_NAME.test(name) || !writtenAt(last, at, 1)) return;
  // A space comes before the ID, unless it starts a line.
  const before = content.at(-2);
  const startsLine = at === 0 && (!before || before.type === "break");
  if (!startsLine && !/\s/.test(last.value.charAt(at - 1))) return;
  const alone = at === 0 && !before;
  if (!alone) {
    const rest = sliceText(last, 0, last.value.slice(0, at).trimEnd().length);
    content.pop();
    if (rest.value !== "") content.push(rest);
    else if (content.at(-1)?.type === "break") content.pop();
  }
  return { id: `^${name}`, alone };
}

function nameBlock(block: Nodes, id: string): void {
  block.data = {
    ...block.data,
    hProperties: { ...block.data?.hProperties, id },
  };
}
