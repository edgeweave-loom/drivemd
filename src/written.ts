import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { Root, Text } from "mdast";
import { visit } from "unist-util-visit";

declare module "mdast" {
  interface TextData {
    /**
     * The offsets of the characters the note escapes, or writes as character
     * references: Obsidian's syntax is made of none of them.
     */
    escaped?: number[] | undefined;
  }
}

/**
 * Notes, on each text, the characters the note escapes or writes as
 * character references, which the parser decodes into the text: `\[!note]`
 * starts no callout, as `\#tag` is no tag.
 */
export function remarkEscapes() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    visit(tree, "text", (node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const escaped = escapes(node.value, source.slice(start, end));
      if (escaped.length > 0) node.data = { ...node.data, escaped };
    });
  };
}

/** Whether the note writes these characters of the text as they are. */
export function writtenAt(node: Text, start: number, length: number): boolean {
  const escaped = node.data?.escaped ?? [];
  const first = escaped[firstFrom(escaped, start)];
  return first === undefined || first >= start + length;
}

/** A part of a text, which keeps what the note escapes in it. */
export function sliceText(node: Text, start: number, end?: number): Text {
  const value = node.value.slice(start, end);
  const all = node.data?.escaped ?? [];
  const escaped = all
    .slice(firstFrom(all, start), firstFrom(all, start + value.length))
    .map((offset) => offset - start);
  return {
    type: "text",
    value,
    ...(escaped.length > 0 && { data: { escaped } }),
  };
}

/** Where the first offset at or after `start` is, among offsets in order. */
function firstFrom(offsets: number[], start: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((offsets[middle] ?? Infinity) < start) low = middle + 1;
    else high = middle;
  }
  return low;
}

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const REFERENCE =
  /^&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]{0,31}));/;

/** The offsets of the text's characters its source escapes. */
export function escapes(value: string, source: string): number[] {
  const escaped: number[] = [];
  let at = 0;
  for (let index = 0; index < value.length && at < source.length;) {
    const character = value.charAt(index);
    if (
      source.charAt(at) === "\\" &&
      source.charAt(at + 1) === character &&
      PUNCTUATION.test(character)
    ) {
      escaped.push(index);
      index += 1;
      at += 2;
      continue;
    }
    const reference =
      source.charAt(at) === "&"
        ? REFERENCE.exec(source.slice(at, at + 40))
        : null;
    const decoded = reference && decode(reference);
    if (reference && decoded && value.startsWith(decoded, index)) {
      for (const offset of decoded.split("").keys()) {
        escaped.push(index + offset);
      }
      index += decoded.length;
      at += reference[0].length;
      continue;
    }
    // What the parser leaves out of the text, such as a quote's `>` or the
    // spaces that end a line, is skipped.
    if (source.charAt(at) === character) index += 1;
    at += 1;
  }
  return escaped;
}

/** What a character reference stands for, as CommonMark decodes it. */
function decode([, decimal, hexadecimal, name]: RegExpExecArray):
  string | false {
  if (name !== undefined) return decodeNamedCharacterReference(name);
  const code = Number.parseInt(decimal ?? hexadecimal ?? "", decimal ? 10 : 16);
  const valid =
    code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return String.fromCodePoint(valid ? code : 0xfffd);
}
