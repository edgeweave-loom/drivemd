import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Rendered } from "./Markdown.tsx";
import { DEFAULT_SETTINGS } from "./vault-settings.ts";

/** Renders a note of a vault, with Obsidian's default settings. */
function show(text: string) {
  return render(<Rendered text={text} vault={DEFAULT_SETTINGS} />).container;
}

/** The text of each element the selector finds. */
function texts(page: HTMLElement, selector: string) {
  return [...page.querySelectorAll(selector)].map(
    (element) => element.textContent,
  );
}

/** The text the note shows, its blocks one space apart. */
function shown(page: HTMLElement) {
  return page.textContent.replace(/\s+/g, " ").trim();
}

describe("highlights in a note of a vault", () => {
  it("mark the text between ==", () => {
    const page = show("Make ==green tea== now.");

    expect(texts(page, "mark")).toEqual(["green tea"]);
    expect(shown(page)).toBe("Make green tea now.");
  });

  it("keep the Markdown inside them", () => {
    const page = show("==**Green** tea== and ==a\nb==");

    expect(page.querySelector("mark strong")).toHaveTextContent("Green");
    expect(texts(page, "mark")).toEqual(["Green tea", "a\nb"]);
  });

  it.each([
    ["spaces inside the marks", "== tea =="],
    ["three = in a row", "a === b === c"],
    ["no closing mark", "x==y"],
    ["code", "`==tea==`"],
  ])("are not made of %s", (_, text) => {
    const page = show(text);

    expect(page.querySelector("mark")).toBeNull();
  });

  it("can hold a mark that a space follows", () => {
    expect(texts(show("==a == b=="), "mark")).toEqual(["a == b"]);
  });
});

describe("comments in a note of a vault", () => {
  it("hide the text between %%", () => {
    const page = show("Tea %%not this%% time, %%nor%%this.");

    expect(shown(page)).toBe("Tea time, this.");
  });

  it("hide the blocks between %% lines", () => {
    const page = show(
      [
        "Before.",
        "",
        "%%",
        "Hidden.",
        "",
        "- hidden too",
        "",
        "```",
        "hidden code",
        "```",
        "%% After.",
        "",
        "Last.",
      ].join("\n"),
    );

    expect(shown(page)).toBe("Before. After. Last.");
    expect(page.querySelector("ul, pre")).toBeNull();
  });

  it("hide what follows in the quote or list item when never closed", () => {
    const page = show("> Quoted %%open\n>\n> hidden\n\nShown.");

    expect(shown(page)).toBe("Quoted Shown.");
  });

  it("hide the rest of the note when never closed", () => {
    expect(shown(show("Shown %%\n\nHidden.\n\n# Hidden"))).toBe("Shown");
  });

  it("hide text in a heading or a table cell", () => {
    const page = show("# Title %%x%%\n\n| A %%x%% |\n| - |\n| b %%y |");

    expect(texts(page, "h1, th, td")).toEqual(["Title ", "A ", "b "]);
  });

  it("are not made in code", () => {
    expect(shown(show("`%%code%%`"))).toBe("%%code%%");
  });
});

describe("tags in a note of a vault", () => {
  it("show as labels", () => {
    const page = show("Steep #tea and #tea/green_1, #café-2.");

    expect(texts(page, ".tag")).toEqual(["#tea", "#tea/green_1", "#café-2"]);
    expect(page.querySelector(".tag")?.tagName).toBe("SPAN");
  });

  it("show in a heading, and at the start of a line", () => {
    const page = show("# Plan #tea\n\n#first\n#second");

    expect(texts(page, ".tag")).toEqual(["#tea", "#first", "#second"]);
  });

  it.each([
    ["a number", "Issue #2024"],
    ["in a word", "C# and a#b"],
    ["after other Markdown", "**bold**#tea"],
    ["in a link", "[#tea](https://example.com)"],
    ["in code", "`#tea`"],
    ["a heading's marks", "# Title"],
  ])("are not %s", (_, text) => {
    expect(show(text).querySelector(".tag")).toBeNull();
  });

  it("may hold numbers with something else", () => {
    expect(texts(show("#2024-plan"), ".tag")).toEqual(["#2024-plan"]);
  });
});

describe("block IDs in a note of a vault", () => {
  it("are hidden, and name the paragraph they end", () => {
    const page = show("Tea time. ^tea-1\n\nNext.");

    const paragraph = page.querySelector("p");
    expect(paragraph).toHaveTextContent(/^Tea time\.$/);
    expect(paragraph).toHaveAttribute("id", "user-content-^tea-1");
  });

  it("name the list item they end", () => {
    const page = show("- Buy tea ^buy\n- Brew it");

    expect(page.querySelector("li")).toHaveAttribute("id", "user-content-^buy");
    expect(shown(page)).toBe("Buy tea Brew it");
  });

  it("name the block before them when on a line of their own", () => {
    const page = show("> A quote.\n\n^quote\n\n| A |\n| - |\n\n^table");

    expect(page.querySelector("blockquote")).toHaveAttribute(
      "id",
      "user-content-^quote",
    );
    expect(page.querySelector("table")).toHaveAttribute(
      "id",
      "user-content-^table",
    );
    expect(shown(page)).toBe("A quote. A");
  });

  it.each([
    ["inside a word", "x^y"],
    ["with a space", "Tea ^not an id"],
    ["first in the note", "^alone"],
  ])("show as written %s", (_, text) => {
    const page = show(text);

    expect(shown(page)).toBe(text);
    expect(page.querySelector("[id]")).toBeNull();
  });
});

describe("Obsidian's syntax in HTML", () => {
  it("cannot be made up with other classes", () => {
    const page = show('<span class="tag evil">#x</span> <mark>kept</mark>');

    expect(page.querySelector("span")).toHaveAttribute("class", "tag");
    expect(page.querySelector("mark")).toHaveTextContent("kept");
  });
});

describe("a note outside a vault", () => {
  it("shows Obsidian's syntax as written", () => {
    const text = "==tea== %%x%% #tag ^id";
    const page = render(<Rendered text={text} />).container;

    expect(shown(page)).toBe(text);
    expect(page.querySelector("mark, .tag, [id]")).toBeNull();
  });
});
