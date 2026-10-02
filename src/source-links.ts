import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { decodeNamedCharacterReference } from "decode-named-character-reference";

/**
 * The address of the Markdown link or image around a place in the text, as
 * a tap in the preview would follow it: of an inline link, an autolink or a
 * bare web or email address. An image inside a link leads where the link
 * does. A reference link names its address elsewhere, and leads nowhere from
 * here.
 */
export function linkAt(state: EditorState, at: number): string | undefined {
  let found: string | undefined;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Link") return addressOf(state, node);
    if (found !== undefined) continue;
    if (node.name === "URL")
      found = address(state.sliceDoc(node.from, node.to));
    else if (node.name === "Image" || node.name === "Autolink") {
      found = addressOf(state, node);
    }
  }
  return found;
}

function addressOf(state: EditorState, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  return url ? address(state.sliceDoc(url.from, url.to)) : undefined;
}

/**
 * An address as Markdown means it: without the angle brackets it may be
 * written in, with its escapes and character references decoded, and with
 * the scheme a bare www or email address takes in the preview.
 */
function address(written: string): string {
  const url = written
    .replace(/^<(.*)>$/s, "$1")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(
      /&(#x[\da-f]+|#\d+|\w+);/gi,
      (reference: string, name: string) => decoded(name) ?? reference,
    );
  if (/^www\./i.test(url)) return `http://${url}`;
  if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(url)) return `mailto:${url}`;
  return url;
}

function decoded(name: string): string | undefined {
  if (!name.startsWith("#"))
    return decodeNamedCharacterReference(name) || undefined;
  const code =
    name[1]?.toLowerCase() === "x"
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}
