const BOM = [0xef, 0xbb, 0xbf];

export type LineBreak = "\n" | "\r\n" | "\r";

/** A file's content as text, and what it takes to write it back unchanged. */
export interface FileText {
  /** The text, with the file's own line breaks, after any byte order mark. */
  text: string;
  /** Whether the file starts with UTF-8's byte order mark. */
  bom: boolean;
  /** The file's line break, which new lines get too. */
  lineBreak: LineBreak;
  /**
   * Why writing the text back would change bytes the user did not edit:
   * DriveMD then only shows the file.
   */
  readOnly: "not-utf8" | "mixed-line-breaks" | undefined;
}

/**
 * The text of a file's bytes. A file that is not UTF-8 shows with
 * replacement characters where its bytes are not.
 */
export function decode(content: Uint8Array): FileText {
  const bom = BOM.every((byte, index) => content[index] === byte);
  const body = bom ? content.subarray(BOM.length) : content;
  try {
    // Without ignoreBOM, a second byte order mark would vanish from the text.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(body);
    const breaks = new Set(text.match(/\r\n|\r|\n/g));
    const [lineBreak = "\n"] = breaks as Set<LineBreak>;
    return {
      text,
      bom,
      lineBreak,
      readOnly: breaks.size > 1 ? "mixed-line-breaks" : undefined,
    };
  } catch {
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(body);
    return { text, bom, lineBreak: "\n", readOnly: "not-utf8" };
  }
}

/** The bytes of a text decoded from a file, as the file holds them. */
export function encode(
  text: string,
  { bom }: Pick<FileText, "bom">,
): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const content = new Uint8Array(BOM.length + body.length);
  content.set(BOM);
  content.set(body, BOM.length);
  return content;
}

export function sameBytes(one: Uint8Array, other: Uint8Array): boolean {
  return (
    one.length === other.length &&
    one.every((byte, index) => byte === other[index])
  );
}
