import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Rendered } from "./Markdown.tsx";
import { VAULT } from "./test/vault.ts";

/** Renders a note of a vault, with Obsidian's default settings. */
function show(text: string, onEdit?: (text: string) => void) {
  return render(<Rendered text={text} vault={VAULT} onEdit={onEdit} />)
    .container;
}

/** The text an element shows, its blocks one space apart. */
function shown(element: Element | null) {
  return element?.textContent.replace(/\s+/g, " ").trim() ?? null;
}

/** Each callout's type, title and content, outermost first. */
function callouts(page: HTMLElement) {
  return [...page.querySelectorAll(".callout")].map((callout) => ({
    tag: callout.tagName.toLowerCase(),
    type: callout.getAttribute("data-callout"),
    title: shown(callout.querySelector(":scope > .callout-title")),
    content: shown(callout.querySelector(":scope > .callout-content")),
  }));
}

/** The icon a callout's title starts with, by its name in Lucide. */
function icon(callout: Element | null | undefined) {
  const first = callout?.querySelector(
    ":scope > .callout-title",
  )?.firstElementChild;
  return first?.tagName.toLowerCase() === "svg"
    ? first.getAttribute("data-icon")?.replace(/^lucide-/, "")
    : null;
}

describe("callouts in a note of a vault", () => {
  it("show their type, title and content", () => {
    const page = show(
      "> [!tip] Brew it hot\n> Water at 90 °C.\n>\n> Then wait.",
    );

    expect(callouts(page)).toEqual([
      {
        tag: "div",
        type: "tip",
        title: "Brew it hot",
        content: "Water at 90 °C. Then wait.",
      },
    ]);
    expect(page.querySelector("blockquote")).toBeNull();
  });

  it.each([
    ["[!WARNING]", "warning", "Warning"],
    ["[!tldr]", "abstract", "Tldr"],
  ])("are titled by their type when untitled: %s", (marker, type, title) => {
    const page = show(`> ${marker}\n> Hot.`);

    expect(callouts(page)).toEqual([
      { tag: "div", type, title, content: "Hot." },
    ]);
  });

  it.each([
    ["note", "note"],
    ["abstract", "abstract"],
    ["summary", "abstract"],
    ["tldr", "abstract"],
    ["info", "info"],
    ["todo", "todo"],
    ["tip", "tip"],
    ["hint", "tip"],
    ["important", "tip"],
    ["success", "success"],
    ["check", "success"],
    ["done", "success"],
    ["question", "question"],
    ["help", "question"],
    ["faq", "question"],
    ["warning", "warning"],
    ["caution", "warning"],
    ["attention", "warning"],
    ["failure", "failure"],
    ["fail", "failure"],
    ["missing", "failure"],
    ["danger", "danger"],
    ["error", "danger"],
    ["bug", "bug"],
    ["example", "example"],
    ["quote", "quote"],
    ["cite", "quote"],
    ["recipe", "note"],
    ["constructor", "note"],
  ])("show the type %s as %s", (name, type) => {
    const page = show(`> [!${name}] Title`);

    expect(callouts(page)[0]?.type).toBe(type);
  });

  // The icons of Obsidian 1.14's stylesheet, by their names in Lucide.
  it.each([
    ["note", "pencil"],
    ["abstract", "clipboard-list"],
    ["tldr", "clipboard-list"],
    ["info", "info"],
    ["todo", "circle-check"],
    ["tip", "flame"],
    ["important", "flame"],
    ["success", "check"],
    ["done", "check"],
    ["question", "circle-question-mark"],
    ["faq", "circle-question-mark"],
    ["warning", "triangle-alert"],
    ["attention", "triangle-alert"],
    ["failure", "x"],
    ["missing", "x"],
    ["danger", "zap"],
    ["error", "zap"],
    ["bug", "bug"],
    ["example", "list"],
    ["quote", "quote"],
    ["cite", "quote"],
    ["recipe", "pencil"],
  ])("start their title with their type's icon: %s", (name, drawn) => {
    const page = show(`> [!${name}] Title\n> Body.`);

    expect(icon(page.querySelector(".callout"))).toBe(drawn);
    expect(callouts(page)[0]?.title).toBe("Title");
  });

  it("show their icon to the eye only, titled or not, folded or not", () => {
    const page = show("> [!tldr]\n> Short.\n\n> [!faq]- Why?\n> Because.");

    const [untitled, folded] = page.querySelectorAll(".callout");
    expect(icon(untitled)).toBe("clipboard-list");
    expect(icon(folded)).toBe("circle-question-mark");
    expect(folded?.querySelector("summary > .callout-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(callouts(page).map(({ title }) => title)).toEqual(["Tldr", "Why?"]);
  });

  it("lay their title out as Obsidian's, with a chevron when they fold, to the eye only", () => {
    const page = show(
      "> [!faq]- Closed\n> Hidden.\n\n> [!faq]+ Open\n> Shown.\n\n> [!note] Still\n> Body.\n\n<details><summary>Plain</summary>Text</details>",
    );

    const parts = (title: Element | undefined) =>
      [...(title?.children ?? [])].map((part) => part.getAttribute("class"));
    const [closed, open, still] = page.querySelectorAll(".callout-title");
    for (const title of [closed, open]) {
      expect(parts(title)).toEqual([
        "callout-icon",
        "callout-title-inner",
        "callout-fold",
      ]);
      const end = title?.lastElementChild;
      expect(end?.tagName.toLowerCase()).toBe("svg");
      expect(end).toHaveAttribute("data-icon", "lucide-chevron-down");
      expect(end).toHaveAttribute("aria-hidden", "true");
    }
    expect(parts(still)).toEqual(["callout-icon", "callout-title-inner"]);
    expect(callouts(page).map(({ title }) => title)).toEqual([
      "Closed",
      "Open",
      "Still",
    ]);
    expect(screen.getByText("Plain").querySelector("svg")).toBeNull();
  });

  it("show an icon in HTML on a title with its type only, as raw HTML may use their classes", () => {
    const page = show(
      '<div class="callout-title">Untyped</div><div class="callout" data-callout="tip">Callout</div><div class="callout-title" data-callout="bug">Title</div>',
    );

    const icons = page.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]?.parentElement).toHaveTextContent("Title");
    expect(icons[0]).toHaveAttribute("data-icon", "lucide-bug");
  });

  it("fold when their type ends with - or +, folded or not", () => {
    const page = show(
      "> [!faq]- Closed\n> Hidden.\n\n> [!faq]+ Open\n> Shown.",
    );

    const [closed, open] = page.querySelectorAll("details");
    expect(callouts(page).map(({ tag, title }) => [tag, title])).toEqual([
      ["details", "Closed"],
      ["details", "Open"],
    ]);
    expect(closed).not.toHaveAttribute("open");
    expect(open).toHaveAttribute("open");
    expect(closed?.querySelector(":scope > summary")).toHaveTextContent(
      "Closed",
    );
  });

  it("nest", () => {
    const page = show(
      "> [!question] Can callouts nest?\n> > [!todo] Yes.\n> > They can.",
    );

    expect(callouts(page)).toEqual([
      {
        tag: "div",
        type: "question",
        title: "Can callouts nest?",
        content: "Yes. They can.",
      },
      { tag: "div", type: "todo", title: "Yes.", content: "They can." },
    ]);
  });

  it("keep the Markdown of their title, up to the line's end", () => {
    const page = show("> [!note] A **bold** title\n> Body.");

    const title = page.querySelector(".callout-title");
    expect(title).toHaveTextContent("A bold title");
    expect(title?.querySelector("strong")).toHaveTextContent("bold");
    expect(callouts(page)[0]?.content).toBe("Body.");
  });

  it("end their title at a hard line break", () => {
    const page = show("> [!note] Title\\\n> Body.");

    expect(callouts(page)[0]).toMatchObject({
      title: "Title",
      content: "Body.",
    });
  });

  it("may hold a title only", () => {
    const page = show("> [!note] Just a title");

    expect(callouts(page)).toEqual([
      { tag: "div", type: "note", title: "Just a title", content: null },
    ]);
  });

  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("split their title from their content at a %s line break", (_, eol) => {
    const page = show(
      ["> [!note] Title", "> Body", "", "> [!faq]-", "> Folded", ""].join(eol),
    );

    expect(callouts(page)).toEqual([
      { tag: "div", type: "note", title: "Title", content: "Body" },
      { tag: "details", type: "question", title: "Faq", content: "Folded" },
    ]);
    expect(page.querySelectorAll(".callout-title br")).toHaveLength(0);
  });

  it.each([
    ["an escaped bracket", "> \\[!note] Escaped"],
    ["an escaped mark", "> [\\!note] Escaped"],
    ["a character reference", "> &#91;!note] Escaped"],
  ])("are no callout when written with %s", (_, text) => {
    const page = show(text);

    expect(callouts(page)).toEqual([]);
    expect(page.querySelector("blockquote")).toHaveTextContent(
      "[!note] Escaped",
    );
  });

  it("show in a list item", () => {
    const page = show("- Item\n\n  > [!tip] Inside\n  > Body");

    expect(page.querySelector("li .callout")).toHaveAttribute(
      "data-callout",
      "tip",
    );
  });

  it("join the lines of their content when the vault says so", () => {
    const page = render(
      <Rendered
        text={"> [!note] Title\n> One\n> Two"}
        vault={{ ...VAULT, settings: { strictLineBreaks: true } }}
      />,
    ).container;

    expect(callouts(page)[0]).toMatchObject({
      title: "Title",
      content: "One Two",
    });
    expect(page.querySelector(".callout br")).toBeNull();
  });

  it("show a marker in their content as written", () => {
    const page = show("> [!note] Title\n> [!tip] Not a callout");

    expect(callouts(page)).toHaveLength(1);
    expect(callouts(page)[0]?.content).toBe("[!tip] Not a callout");
  });

  it("show their lines as Obsidian does", () => {
    const page = show("> [!note]\n> One\n> Two");

    expect(page.querySelectorAll(".callout-content br")).toHaveLength(1);
  });

  it("let the user check their tasks", () => {
    const edit = vi.fn();
    show("> [!todo]\n> - [ ] Tea", edit);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(edit).toHaveBeenCalledExactlyOnceWith("> [!todo]\n> - [x] Tea");
  });

  it("are no callout when the marker does not start the quote's text", () => {
    const page = show(
      [
        "> Quoted [!note]",
        "> [!note]x",
        "> - [!note] In a list",
        "> *[!note]* Emphasized",
        ">",
      ].join("\n\n"),
    );

    expect(callouts(page)).toEqual([]);
    expect(page.querySelectorAll("blockquote")).toHaveLength(5);
  });

  it("keep their own classes and types only, when written in HTML", () => {
    const page = show(
      '<div class="callout evil" data-callout="tip">Tip</div><div class="callout" data-callout="evil">Evil</div>',
    );

    const [tip, evil] = page.querySelectorAll(".callout");
    expect(tip).toHaveAttribute("class", "callout");
    expect(tip).toHaveAttribute("data-callout", "tip");
    expect(evil).not.toHaveAttribute("data-callout");
  });

  it("keep nothing else of a folded one written in HTML", () => {
    const page = show(
      '<details class="callout x" data-callout="faq" open ontoggle="alert(1)" style="color: red" id="mine"><summary class="callout-title y" onclick="alert(1)">Q</summary>A</details>',
    );

    const details = page.querySelector("details");
    expect(details?.getAttributeNames().sort()).toEqual([
      "class",
      "id",
      "open",
    ]);
    expect(details).toHaveAttribute("class", "callout");
    expect(details).toHaveAttribute("id", "user-content-mine");
    expect(page.querySelector("summary")?.getAttributeNames()).toEqual([
      "class",
    ]);
    expect(page.querySelector("summary")).toHaveAttribute(
      "class",
      "callout-title",
    );
  });
});

describe("a note outside a vault", () => {
  it("keeps GitHub's rules for HTML", () => {
    const page = render(
      <Rendered text={'<div class="callout" data-callout="tip">Tip</div>'} />,
    ).container;

    const div = page.querySelector(".markdown div");
    expect(div).not.toHaveAttribute("class");
    expect(div).not.toHaveAttribute("data-callout");
  });

  it("shows a callout's marker as written, in a quote", () => {
    const page = render(<Rendered text="> [!tip] Brew it hot" />).container;

    expect(page.querySelector(".callout")).toBeNull();
    expect(page.querySelector("blockquote")).toHaveTextContent(
      "[!tip] Brew it hot",
    );
  });
});
