import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Rendered } from "./Markdown.tsx";
import { DEFAULT_SETTINGS } from "./vault-settings.ts";

/** Renders a note of a vault, with Obsidian's default settings. */
function show(text: string, onEdit?: (text: string) => void) {
  return render(
    <Rendered text={text} vault={DEFAULT_SETTINGS} onEdit={onEdit} />,
  ).container;
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

  it("cannot be made up in HTML with other classes or handlers", () => {
    const page = show(
      '<div class="callout evil" data-callout="tip" onclick="alert(1)">Hi</div>',
    );

    const made = page.querySelector(".callout");
    expect(made).toHaveAttribute("class", "callout");
    expect(made).not.toHaveAttribute("onclick");
  });
});

describe("a note outside a vault", () => {
  it("shows a callout's marker as written, in a quote", () => {
    const page = render(<Rendered text="> [!tip] Brew it hot" />).container;

    expect(page.querySelector(".callout")).toBeNull();
    expect(page.querySelector("blockquote")).toHaveTextContent(
      "[!tip] Brew it hot",
    );
  });
});
