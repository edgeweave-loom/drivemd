import type { Code, Root, Table, TableRow } from "mdast";
import { parse } from "yaml";

/**
 * Shows a note's front matter, which remark-frontmatter finds, as a table of
 * its properties rather than as Markdown. Front matter that holds no
 * properties, such as a list or YAML that does not parse, shows as written.
 */
export function remarkProperties() {
  return (tree: Root) => {
    const [first] = tree.children;
    if (first?.type !== "yaml") return;
    const properties = parsed(first.value);
    if (properties === null) tree.children.shift();
    else if (properties instanceof Map) tree.children[0] = table(properties);
    else tree.children[0] = written(first.value);
  };
}

/** The front matter's value, or undefined when it is not YAML. */
function parsed(yaml: string): unknown {
  try {
    // Maps keep the properties' order, and no key can reach a prototype.
    return parse(yaml, { mapAsMap: true, logLevel: "error" });
  } catch {
    return undefined;
  }
}

function table(properties: Map<unknown, unknown>): Table {
  return {
    type: "table",
    children: [
      row("Property", "Value"),
      ...[...properties].map(([name, value]) => row(shown(name), shown(value))),
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

/** A property's value as text: lists and maps on one line. */
function shown(value: unknown): string {
  if (Array.isArray(value)) return value.map(shown).join(", ");
  if (value instanceof Map) {
    return [...value]
      .map(([name, inner]) => `${shown(name)}: ${shown(inner)}`)
      .join(", ");
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  // A property left empty.
  return "";
}
