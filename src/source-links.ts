import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * The address of the Markdown link or image around a place in the text, as
 * written: of an inline link, an autolink or a bare web address. A reference
 * link names its address elsewhere, and leads nowhere from here.
 */
export function linkAt(state: EditorState, at: number): string | undefined {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "URL") return address(state, node);
    if (["Link", "Image", "Autolink"].includes(node.name)) {
      const url = node.getChild("URL");
      return url ? address(state, url) : undefined;
    }
  }
  return undefined;
}

/** A link's address, without the angle brackets it may be written in. */
function address(state: EditorState, url: SyntaxNode): string {
  return state.sliceDoc(url.from, url.to).replace(/^<(.*)>$/, "$1");
}
