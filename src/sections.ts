import { slug } from "github-slugger";

const LINE_BREAK = /\r\n?|\n/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const BLOCK_NAME = /^[A-Za-z0-9-]+$/;

/** A line of a note, as embeds read it. */
interface Line {
  text: string;
  /** In a fenced code block, where no heading or block ID is. */
  code: boolean;
  /** A heading's level, if the line is one. */
  level: number | undefined;
}

/**
 * The part of a note an embed names after its `#`, as Obsidian shows it: a
 * heading's section, with the headings under it, up to the next heading of
 * its level or above, the heading found by its text as the viewer names it;
 * or the block a `^id` names. The whole note for no part, and nothing for a
 * part the note does not have.
 */
export function partOf(text: string, part: string): string | undefined {
  if (part === "") return text;
  const lineBreak = LINE_BREAK.exec(text)?.[0] ?? "\n";
  const lines = read(text);
  const found = part.startsWith("^")
    ? block(lines, part.slice(1))
    : section(lines, part);
  return found?.join(lineBreak);
}

function read(text: string): Line[] {
  let fence: string | undefined;
  return text.split(LINE_BREAK).map((line) => {
    const opened = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      // A fence closes with as many of its marks, or more.
      if (opened?.startsWith(fence)) fence = undefined;
      return { text: line, code: true, level: undefined };
    }
    if (opened !== undefined) {
      fence = opened;
      return { text: line, code: true, level: undefined };
    }
    return { text: line, code: false, level: HEADING.exec(line)?.[1]?.length };
  });
}

function section(lines: Line[], heading: string): string[] | undefined {
  const wanted = slug(heading);
  const start = lines.findIndex(
    ({ text, level }) =>
      level !== undefined && slug(HEADING.exec(text)?.[2] ?? "") === wanted,
  );
  const level = lines[start]?.level;
  if (level === undefined) return;
  const end = lines.findIndex(
    (line, index) =>
      index > start && line.level !== undefined && line.level <= level,
  );
  return lines.slice(start, end < 0 ? lines.length : end).map(textOf);
}

function block(lines: Line[], id: string): string[] | undefined {
  if (!BLOCK_NAME.test(id)) return;
  const at = lines.findIndex(
    ({ text, code }) =>
      !code && new RegExp(`(?:^|\\s)\\^${id}$`).test(text.trimEnd()),
  );
  const line = lines[at];
  if (!line) return;
  if (line.text.trim() === `^${id}`) {
    // On a line of its own, the ID names the block before.
    let end = at;
    while (end > 0 && lines[end - 1]?.text.trim() === "") end -= 1;
    return around(lines, end - 1);
  }
  if (LIST_ITEM.test(line.text)) return [line.text];
  return around(lines, at);
}

/** The lines of the block around a line: up to blank lines or headings. */
function around(lines: Line[], at: number): string[] | undefined {
  const inBlock = (index: number) => {
    const line = lines[index];
    return (
      line !== undefined && line.text.trim() !== "" && line.level === undefined
    );
  };
  if (!inBlock(at)) return;
  let start = at;
  let end = at + 1;
  while (inBlock(start - 1)) start -= 1;
  while (inBlock(end)) end += 1;
  return lines.slice(start, end).map(textOf);
}

function textOf({ text }: Line): string {
  return text;
}
