import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { withFrontmatter } from "./frontmatter.ts";
import { Rendered } from "./Markdown.tsx";
import { decode, encode, type LineBreak } from "./text.ts";

function edited(text: string, lineBreak: LineBreak = "\n") {
  return EditorState.create({
    doc: text,
    extensions: [
      EditorState.lineSeparator.of(lineBreak),
      withFrontmatter(markdown({ base: markdownLanguage })),
    ],
  });
}

function tree(state: EditorState) {
  const parsed = ensureSyntaxTree(state, state.doc.length, 5_000);
  if (!parsed) throw new Error("Not parsed");
  return parsed;
}

/** The lines between the fences of the front matter the editor finds. */
function inEditor(state: EditorState) {
  const frontmatter = tree(state).topNode.getChild("Frontmatter");
  const [open, close] = frontmatter?.getChildren("FrontmatterMark") ?? [];
  if (!open || !close) return null;
  const lines = [];
  const last = state.doc.lineAt(close.from).number;
  for (let at = state.doc.lineAt(open.to).number + 1; at < last; at += 1) {
    lines.push(state.doc.line(at).text);
  }
  return lines.join("\n");
}

/** The names of the syntax nodes around a place, from the innermost. */
function around(state: EditorState, at: number) {
  const names = [];
  for (
    let node: SyntaxNode | null = tree(state).resolveInner(at, 1);
    node;
    node = node.parent
  ) {
    names.push(node.name);
  }
  return names;
}

/** The properties the viewer shows in its table, one per line. */
function inViewer(text: string) {
  const { container } = render(<Rendered text={text} />);
  const rows = [...container.querySelectorAll("tr")].slice(1);
  if (rows.length === 0) return null;
  return rows
    .map((row) => [...row.cells].map((cell) => cell.textContent).join(": "))
    .join("\n");
}

describe("withFrontmatter", () => {
  it.each<[string, string, LineBreak, string | null]>([
    [
      "front matter",
      "---\nowner: Ada\nteam: Tea\n---\n# Plan\n",
      "\n",
      "owner: Ada\nteam: Tea",
    ],
    [
      "a byte order mark, which decoding takes off",
      decode(encode("---\nowner: Ada\n---\n# Plan\n", { bom: true })).text,
      "\n",
      "owner: Ada",
    ],
    [
      "a second byte order mark, which the text keeps",
      "\uFEFF---\nowner: Ada\n---\n# Plan\n",
      "\n",
      "owner: Ada",
    ],
    [
      "Windows line breaks",
      "---\r\nowner: Ada\r\n---\r\n# Plan\r\n",
      "\r\n",
      "owner: Ada",
    ],
    [
      "old Mac line breaks",
      "---\rowner: Ada\r---\r# Plan\r",
      "\r",
      "owner: Ada",
    ],
    [
      "spaces after the fences",
      "--- \t\nowner: Ada\n---  \n# Plan\n",
      "\n",
      "owner: Ada",
    ],
    [
      "a closing fence that ends the note",
      "---\nowner: Ada\n---",
      "\n",
      "owner: Ada",
    ],
    [
      "two closing fences",
      "---\nowner: Ada\n---\nteam: Tea\n---\n",
      "\n",
      "owner: Ada",
    ],
    ["no closing fence", "---\nowner: Ada\n\n# Plan\n", "\n", null],
    ["a fence that ends the note", "---", "\n", null],
    ["a fence and a line break that end the note", "---\n", "\n", null],
    ["a longer dash line", "---\nowner: Ada\n----\n# Plan\n", "\n", null],
    ["fences of four dashes", "----\nowner: Ada\n----\n", "\n", null],
    ["a fence after the first line", "\n---\nowner: Ada\n---\n", "\n", null],
    ["an indented fence", " ---\nowner: Ada\n---\n", "\n", null],
    ["text after the fence", "--- x\nowner: Ada\n---\n", "\n", null],
  ])(
    "finds front matter where the viewer does: %s",
    (_, text, lineBreak, frontmatter) => {
      expect(inViewer(text)).toBe(frontmatter);
      expect(inEditor(edited(text, lineBreak))).toBe(frontmatter);
    },
  );

  it("finds front matter that holds nothing, which the viewer hides", () => {
    const text = "---\n---\n# Plan";

    expect(inEditor(edited(text))).toBe("");
    const { container } = render(<Rendered text={text} />);
    expect(container.querySelector("hr, table")).toBeNull();
  });

  it("reads front matter as YAML, and the rest of the note as Markdown", () => {
    const state = edited("---\nowner: Ada\n---\n# Plan\n");

    expect(around(state, 4)).toEqual(
      expect.arrayContaining(["Key", "Frontmatter"]),
    );
    expect(around(state, 21)).toContain("ATXHeading1");
    expect(around(state, 21)).not.toContain("Frontmatter");
  });

  it("reads the first line after a second byte order mark as Markdown, as the viewer does", () => {
    const state = edited("\uFEFF# Plan");

    expect(tree(state).resolveInner(1, 1).name).toBe("HeaderMark");
  });

  it("follows edits that close front matter, and open it again", () => {
    const unclosed = edited("---\nowner: Ada\n# Plan\n");
    expect(inEditor(unclosed)).toBeNull();

    const closed = unclosed.update({ changes: { from: 15, insert: "---\n" } });
    expect(inEditor(closed.state)).toBe("owner: Ada");

    const reopened = closed.state.update({ changes: { from: 15, to: 19 } });
    expect(inEditor(reopened.state)).toBeNull();
  });
});
