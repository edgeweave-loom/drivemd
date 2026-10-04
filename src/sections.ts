import { slug } from "github-slugger";

const LINE_BREAK = /\r\n?|\n/;
// Written so that a long line never makes it try again from each space.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t](.*))?$/;
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const BLOCK_NAME = /^[A-Za-z0-9-]+$/;

/** A line of a note, as embeds read it. */
interface Line {
  text: string;
  /**
   * In code, properties or a comment, where no heading or block ID is, or a
   * heading's underline.
   */
  hidden: boolean;
  /** A heading's level, if the line is one. */
  level: number | undefined;
  /** A heading's text, if the line is one. */
  heading: string | undefined;
}

/**
 * The part of a note an embed names after its `#`, as Obsidian shows it: a
 * heading's section, with the headings under it, up to the next heading of
 * its level or above, the heading found by its text as the viewer names it;
 * or the block a `^id` names. The whole note, but its properties, for no
 * part, and nothing for a part the note does not have.
 */
export function partOf(text: string, part: string): string | undefined {
  const lineBreak = LINE_BREAK.exec(text)?.[0] ?? "\n";
  const lines = read(text);
  const found =
    part === ""
      ? whole(lines)
      : part.startsWith("^")
        ? block(lines, part.slice(1))
        : section(lines, part);
  return found?.join(lineBreak);
}

function read(text: string): Line[] {
  const lines = text.split(LINE_BREAK);
  const read: Line[] = [];
  let fence: string | undefined;
  let comment = false;
  // Properties, as front matter, open the note.
  let properties = lines[0] === "---";
  for (const [index, line] of lines.entries()) {
    const hidden = (): Line => ({
      text: line,
      hidden: true,
      level: undefined,
      heading: undefined,
    });
    if (properties) {
      if (index > 0 && line === "---") properties = false;
      read.push(hidden());
      continue;
    }
    const opened = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      // A fence closes with as many of its marks, or more.
      if (opened?.startsWith(fence)) fence = undefined;
      read.push(hidden());
      continue;
    }
    if (opened !== undefined) {
      fence = opened;
      read.push(hidden());
      continue;
    }
    const inComment = comment;
    // A comment opens or closes with each `%%`.
    if ((line.split("%%").length - 1) % 2 === 1) comment = !comment;
    if (inComment || comment) {
      read.push(hidden());
      continue;
    }
    const atx = HEADING.exec(line);
    const underline = UNDERLINE.exec(line)?.[1];
    const above = read.at(-1);
    if (atx?.[1]) {
      read.push({
        text: line,
        hidden: false,
        level: atx[1].length,
        heading: headingText(atx[2] ?? ""),
      });
    } else if (underline && above && plain(above)) {
      // A paragraph's last line, underlined, is a heading.
      above.level = underline.startsWith("=") ? 1 : 2;
      above.heading = above.text.trim();
      read.push(hidden());
    } else {
      read.push({
        text: line,
        hidden: false,
        level: undefined,
        heading: undefined,
      });
    }
  }
  return read;
}

/** Whether a line is plain text, which an underline makes a heading. */
function plain(line: Line): boolean {
  return (
    !line.hidden &&
    line.level === undefined &&
    line.text.trim() !== "" &&
    !LIST_ITEM.test(line.text)
  );
}

/** A heading's text, without the `#` that may close it. */
function headingText(written: string): string {
  const text = written.trimEnd();
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === "#") end -= 1;
  if (end === text.length) return text.trim();
  if (end === 0 || /[ \t]/.test(text.charAt(end - 1))) {
    return text.slice(0, end).trim();
  }
  return text.trim();
}

/** The note's lines but its properties, which Obsidian shows in no embed. */
function whole(lines: Line[]): string[] {
  const end =
    lines[0]?.text === "---"
      ? lines.findIndex((line, index) => index > 0 && line.text === "---")
      : -1;
  return lines.slice(end + 1).map(textOf);
}

function section(lines: Line[], heading: string): string[] | undefined {
  const wanted = slug(heading);
  const start = lines.findIndex(
    (line) => line.heading !== undefined && slug(line.heading) === wanted,
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
    ({ text, hidden }) => !hidden && endsWithId(text.trimEnd(), id),
  );
  const line = lines[at];
  if (!line) return;
  if (line.text.trim() === `^${id}`) {
    // On a line of its own, the ID names the block before.
    let end = at;
    while (end > 0 && lines[end - 1]?.text.trim() === "") end -= 1;
    return around(lines, end - 1);
  }
  const item = LIST_ITEM.exec(line.text);
  if (item) return listItem(lines, at, item[1]?.length ?? 0);
  return around(lines, at);
}

/** Whether a line ends with the block ID, after a space or alone. */
function endsWithId(text: string, id: string): boolean {
  const mark = `^${id}`;
  if (!text.endsWith(mark)) return false;
  const before = text.charAt(text.length - mark.length - 1);
  return before === "" || /\s/.test(before);
}

/** A list item's lines: its own, then those indented under it. */
function listItem(lines: Line[], at: number, indent: number): string[] {
  let end = at + 1;
  for (; end < lines.length; end += 1) {
    const text = lines[end]?.text ?? "";
    if (text.trim() === "") break;
    if (text.length - text.trimStart().length <= indent) break;
  }
  return lines.slice(at, end).map(textOf);
}

/**
 * The lines of the block around a line: up to blank lines, headings, code,
 * or a list beside a paragraph.
 */
function around(lines: Line[], at: number): string[] | undefined {
  const here = lines[at];
  if (!here || !inBlock(here)) return;
  const list = LIST_ITEM.test(here.text);
  const same = (index: number) => {
    const line = lines[index];
    return (
      line !== undefined &&
      inBlock(line) &&
      (list || !LIST_ITEM.test(line.text))
    );
  };
  let start = at;
  let end = at + 1;
  while (same(start - 1)) start -= 1;
  while (same(end)) end += 1;
  return lines.slice(start, end).map(textOf);
}

function inBlock(line: Line): boolean {
  return !line.hidden && line.text.trim() !== "" && line.level === undefined;
}

function textOf({ text }: Line): string {
  return text;
}
