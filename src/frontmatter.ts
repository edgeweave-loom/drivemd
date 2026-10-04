import { yamlLanguage } from "@codemirror/lang-yaml";
import {
  defineLanguageFacet,
  Language,
  languageDataProp,
  LanguageSupport,
} from "@codemirror/language";
import {
  NodeType,
  parseMixed,
  Parser,
  Tree,
  type Input,
  type ParseWrapper,
  type PartialParse,
  type TreeFragment,
} from "@lezer/common";
import { styleTags, tags } from "@lezer/highlight";

const data = defineLanguageFacet();

const DOCUMENT = NodeType.define({
  id: 0,
  name: "Document",
  top: true,
  props: [[languageDataProp, data]],
});
const FRONTMATTER = NodeType.define({ id: 1, name: "Frontmatter" });
const FENCE = NodeType.define({
  id: 2,
  name: "FrontmatterMark",
  props: [styleTags({ FrontmatterMark: tags.processingInstruction })],
});
const CONTENT = NodeType.define({ id: 3, name: "FrontmatterContent" });
const BODY = NodeType.define({ id: 4, name: "Body" });

const BYTE_ORDER_MARK = "\uFEFF";

const FENCE_LINE = /^---[ \t]*$/;

/**
 * Notes in the `content` language, with front matter in YAML where the
 * viewer's remark-frontmatter finds it. The front matter of
 * @codemirror/lang-yaml follows other rules: it takes the rest of the note
 * when no fence closes it, closes at a line of four dashes, and misses a
 * fence that spaces follow.
 */
export function withFrontmatter(content: LanguageSupport): LanguageSupport {
  const nest = parseMixed((node) => {
    if (node.type === CONTENT) return { parser: yamlLanguage.parser };
    if (node.type === BODY) return { parser: content.language.parser };
    return null;
  });
  return new LanguageSupport(
    new Language(data, new Outline(nest)),
    content.support,
  );
}

/** Parses a note into its front matter and its body, for `nest` to fill. */
class Outline extends Parser {
  private readonly nest: ParseWrapper;

  constructor(nest: ParseWrapper) {
    super();
    this.nest = nest;
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const from = ranges[0]?.from ?? 0;
    const to = ranges.at(-1)?.to ?? input.length;
    const tree = outline(input, from, to);
    const parsed: PartialParse = {
      advance: () => tree,
      parsedPos: to,
      stoppedAt: null,
      stopAt: () => undefined,
    };
    return this.nest(parsed, input, fragments, ranges);
  }
}

/**
 * The note between `from` and `to`, as its front matter, if closed, then its
 * body. A byte order mark left in the text, as a file with two keeps its
 * second, is neither: the viewer reads the note after it.
 */
function outline(input: Input, from: number, to: number): Tree {
  const start =
    input.read(from, from + 1) === BYTE_ORDER_MARK ? from + 1 : from;
  const fences = fencesAt(input, start, to);
  if (!fences) return node(DOCUMENT, from, to, [node(BODY, start, to)]).tree;
  const [open, close] = fences;
  return node(DOCUMENT, from, to, [
    node(FRONTMATTER, open.from, close.to, [
      node(FENCE, open.from, open.to),
      node(CONTENT, open.to + 1, close.from),
      node(FENCE, close.from, close.to),
    ]),
    node(BODY, close.to, to),
  ]).tree;
}

interface Placed {
  from: number;
  tree: Tree;
}

/**
 * A syntax node at its place in the note: a Tree places its children
 * relative to itself.
 */
function node(
  type: NodeType,
  from: number,
  to: number,
  children: readonly Placed[] = [],
): Placed {
  return {
    from,
    tree: new Tree(
      type,
      children.map((child) => child.tree),
      children.map((child) => child.from - from),
      to - from,
    ),
  };
}

/**
 * The fences of the front matter that starts at `start`, as
 * remark-frontmatter finds them: the opening one on the note's first line,
 * the closing one on the first fence line after it, if any.
 */
function fencesAt(input: Input, start: number, to: number) {
  const open = lineAt(input, start, to);
  if (!FENCE_LINE.test(open.text)) return null;
  for (let line = open; line.to < to;) {
    line = lineAt(input, line.to + 1, to);
    if (FENCE_LINE.test(line.text)) return [open, line] as const;
  }
  return null;
}

/**
 * The line that starts at `from`, without its line break. CodeMirror joins
 * the lines it gives a parser with "\n", whatever the file's line break.
 * The line comes from the input's chunks, as reading it again would copy
 * it: a note whose first fence never closes is scanned whole at every edit.
 */
function lineAt(input: Input, from: number, to: number) {
  let text = "";
  for (let at = from; at < to;) {
    const chunk = input.chunk(at).slice(0, to - at);
    const lineBreak = chunk.indexOf("\n");
    if (lineBreak >= 0) {
      return {
        from,
        to: at + lineBreak,
        text: text + chunk.slice(0, lineBreak),
      };
    }
    text += chunk;
    at += chunk.length;
  }
  return { from, to, text };
}
