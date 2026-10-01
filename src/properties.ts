import type { Code, Root, Table, TableRow } from "mdast";
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";

/**
 * Shows a note's front matter, which remark-frontmatter finds, as a table of
 * its properties rather than as Markdown. Front matter that holds no
 * properties, such as a list or YAML that does not parse, shows as written.
 */
export function remarkProperties() {
  return (tree: Root) => {
    const [first] = tree.children;
    if (first?.type !== "yaml") return;
    const document = parseDocument(first.value);
    const { contents } = document;
    if (document.errors.length === 0 && contents === null) {
      tree.children.shift();
    } else if (document.errors.length === 0 && isMap(contents)) {
      tree.children[0] = table(
        contents.items.map(({ key, value }) => [shown(key), shown(value)]),
      );
    } else {
      tree.children[0] = written(first.value);
    }
  };
}

function table(properties: [string, string][]): Table {
  return {
    type: "table",
    children: [
      row("Property", "Value"),
      ...properties.map(([name, value]) => row(name, value)),
    ],
  };
}

function row(...cells: string[]): TableRow {
  return {
    type: "tableRow",
    children: cells.map((cell) => ({
      type: "tableCell",
      children: cell === "" ? [] : [{ type: "text", value: cell }],
    })),
  };
}

function written(yaml: string): Code {
  return { type: "code", lang: "yaml", value: yaml };
}

/**
 * A YAML node as the note writes it, lists and maps on one line: `1.10`
 * stays 1.10, where YAML would read 1.1. An alias shows as written too,
 * which also keeps aliases from multiplying into a huge table.
 */
function shown(node: unknown): string {
  if (isScalar(node)) return node.source ?? "";
  if (isSeq(node)) return node.items.map(shown).join(", ");
  if (isMap(node)) {
    return node.items
      .map(({ key, value }) => `${shown(key)}: ${shown(value)}`)
      .join(", ");
  }
  if (isAlias(node)) return `*${node.source}`;
  // A property left without a value.
  return "";
}
