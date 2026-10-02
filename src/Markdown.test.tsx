import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rendered } from "./Markdown.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The text of each cell, row by row. */
function rows(page: HTMLElement) {
  return [...page.querySelectorAll("tr")].map((row) =>
    [...row.cells].map((cell) => cell.textContent),
  );
}

function show(text: string) {
  return render(<Rendered text={text} />).container;
}

describe("Rendered", () => {
  it("renders GitHub's extras: tables, task lists, strikethrough and autolinks", () => {
    show(
      [
        "# Plan",
        "",
        "| Step | Done |",
        "| ---- | ---- |",
        "| One  | yes  |",
        "",
        "- [ ] write",
        "- [x] read",
        "",
        "~~old~~ www.example.com",
      ].join("\n"),
    );

    expect(screen.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("One");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ]);
    expect(screen.getByText("old").tagName).toBe("DEL");
    expect(
      screen.getByRole("link", { name: "www.example.com" }),
    ).toHaveAttribute("href", "http://www.example.com");
  });

  it("renders footnotes, whose links scroll within the page", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const page = show("Tea[^thé].\n\n[^thé]: Green.");

    expect(page.querySelector("section[data-footnotes]")).toHaveTextContent(
      "Green.",
    );
    const before = window.location.href;
    fireEvent.click(screen.getByRole("link", { name: "1" }));
    fireEvent.click(screen.getByRole("link", { name: "Back to reference 1" }));

    expect(window.location.href).toBe(before);
    expect(scrolled.mock.contexts).toEqual([
      page.querySelector("section[data-footnotes] li"),
      page.querySelector("sup a"),
    ]);
    expect(scrolled.mock.contexts).not.toContain(null);
  });

  it("leaves the page where it is for a link to nothing in it", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    show("[Up](#nowhere) [Odd](#%E0)");

    fireEvent.click(screen.getByRole("link", { name: "Up" }));
    fireEvent.click(screen.getByRole("link", { name: "Odd" }));

    expect(scrolled).not.toHaveBeenCalled();
  });

  it("shows a note it cannot render as written, and renders it again once it changes", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // Each level of nesting takes a level of the stack.
    const deep = `${"<b>".repeat(4_000)} Tea`;
    const { container, rerender } = render(<Rendered text={deep} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "DriveMD could not render this note, so it shows as written.",
    );
    expect(container.querySelector("pre")).toHaveTextContent(deep);
    expect(error).toHaveBeenCalled();
    rerender(<Rendered text="# Tea" />);
    expect(screen.getByRole("heading", { name: "Tea" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("highlights code in the language it names, and shows other code as written", () => {
    const page = show(
      "```js\nconst tea = 1;\n```\n\n```nope\nconst tea = 1;\n```\n\n```mermaid\ngraph TD\n```",
    );

    const [js, other, mermaid] = page.querySelectorAll("pre code");
    expect(js?.querySelector(".hljs-keyword")).toHaveTextContent("const");
    expect(other?.querySelector("span")).toBeNull();
    expect(other).toHaveTextContent("const tea = 1;");
    expect(mermaid).toHaveTextContent("graph TD");
  });

  it("shows math as written", () => {
    show("$x^2$ and $$y$$");

    expect(screen.getByText("$x^2$ and $$y$$")).toBeVisible();
  });

  it("opens web links in a new tab, telling the site nothing", () => {
    show("[Docs](https://example.com/docs) and [mail](mailto:ada@example.com)");

    const docs = screen.getByRole("link", { name: "Docs" });
    expect(docs).toHaveAttribute("href", "https://example.com/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noreferrer");
    const mail = screen.getByRole("link", { name: "mail" });
    expect(mail).toHaveAttribute("href", "mailto:ada@example.com");
    expect(mail).not.toHaveAttribute("target");
  });

  it("never links to script", () => {
    show("[run](javascript:alert(1)) [data](data:text/html,hi)");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("run")).toBeVisible();
  });

  it("does not load images from other sites, linking to them instead", () => {
    const page = show(
      "![A chart](https://example.com/chart.png) ![](https://example.com/b.png)",
    );

    expect(page.querySelector("img")).toBeNull();
    const chart = screen.getByRole("link", { name: "Image: A chart" });
    expect(chart).toHaveAttribute("href", "https://example.com/chart.png");
    expect(chart).toHaveAttribute("target", "_blank");
    expect(chart).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByRole("link", { name: "Image: https://example.com/b.png" }),
    ).toBeVisible();
  });

  it("shows relative links and images as text until they resolve in Drive", () => {
    const page = show("[Other](other.md) ![Photo](img/photo.png)");

    expect(screen.queryByRole("link")).toBeNull();
    expect(page.querySelector("img")).toBeNull();
    expect(screen.getByText("Other")).toBeVisible();
    expect(screen.getByText("Photo")).toBeVisible();
  });

  it("renders raw HTML as GitHub does, without scripts, handlers or styles", () => {
    const page = show(
      [
        '<b>bold</b> <script>alert(1)</script> <img src="x" onerror="alert(1)">',
        "",
        '<span style="color: red" onclick="alert(1)">red</span>',
        "",
        '<a href="javascript:alert(1)">run</a> <iframe src="https://example.com"></iframe>',
        "",
        "<details><summary>More</summary>",
        "",
        "Hidden *text*.",
        "",
        "</details>",
      ].join("\n"),
    );

    expect(page.querySelector("b")).toHaveTextContent("bold");
    expect(
      page.querySelector("script, iframe, img, [onerror], [onclick]"),
    ).toBeNull();
    expect(page.innerHTML).not.toMatch(/alert|style=/);
    expect(screen.getByText("red")).not.toHaveAttribute("style");
    expect(screen.queryByRole("link", { name: "run" })).toBeNull();
    expect(page.querySelector("details summary")).toHaveTextContent("More");
    expect(page.querySelector("details em")).toHaveTextContent("text");
  });

  it("hides HTML comments", () => {
    const page = show(
      "Tea <!-- inline --> time.\n\n<!--\nA block\n-->\n\nCups.",
    );

    expect(page).toHaveTextContent("Tea time. Cups.");
    expect(page.innerHTML).not.toMatch(/inline|block/);
  });

  it("scrolls to the anchors a note's HTML marks, by id or by name", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const page = show(
      '<a id="setup"></a>Setup\n\n<a name="usage"></a>Usage\n\n[One](#setup) [Two](#usage)',
    );

    fireEvent.click(screen.getByRole("link", { name: "One" }));
    fireEvent.click(screen.getByRole("link", { name: "Two" }));

    expect(scrolled.mock.contexts).toEqual([
      page.querySelector("#user-content-setup"),
      page.querySelector("#user-content-usage"),
    ]);
    expect(scrolled.mock.contexts).not.toContain(null);
  });

  it("keeps the ids a note gives apart from the app's own", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const page = show(
      '<h2 id="google">Raw</h2>\n\n## Set up\n\n[Up](#google) [Setup](#set-up)',
    );

    expect(page.querySelector("#google")).toBeNull();
    expect(screen.getByRole("heading", { name: "Raw" })).toHaveAttribute(
      "id",
      "user-content-google",
    );
    fireEvent.click(screen.getByRole("link", { name: "Up" }));
    fireEvent.click(screen.getByRole("link", { name: "Setup" }));

    expect(scrolled.mock.contexts).toEqual([
      screen.getByRole("heading", { name: "Raw" }),
      screen.getByRole("heading", { name: "Set up" }),
    ]);
  });

  it("shows front matter as a table of properties", () => {
    const page = show(
      [
        "---",
        "title: Plan",
        "tags: [tea, cups]",
        "draft: false",
        "empty:",
        "owner: { name: Ada, team: Tea }",
        "---",
        "# Body",
      ].join("\n"),
    );

    expect(rows(page)).toEqual([
      ["Property", "Value"],
      ["title", "Plan"],
      ["tags", "tea, cups"],
      ["draft", "false"],
      ["empty", ""],
      ["owner", "name: Ada, team: Tea"],
    ]);
    expect(screen.getByRole("heading", { name: "Body" })).toBeVisible();
    expect(page.querySelector("hr")).toBeNull();
  });

  it("shows property values as written, never as YAML reads them", () => {
    const page = show(
      [
        "---",
        "version: 1.10",
        "id: 12345678901234567890",
        "color: 0x1F",
        "flag: True",
        'title: "Plan \\"B\\""',
        "tags: [1.0, 'tea']",
        "base: &cups 2.50",
        "again: *cups",
        "---",
      ].join("\n"),
    );

    expect(rows(page).slice(1)).toEqual([
      ["version", "1.10"],
      ["id", "12345678901234567890"],
      ["color", "0x1F"],
      ["flag", "True"],
      ["title", 'Plan "B"'],
      ["tags", "1.0, tea"],
      ["base", "2.50"],
      ["again", "*cups"],
    ]);
  });

  it("shows an alias that refers to itself, and a key given twice, as written", () => {
    const page = show("---\nloop: &a [*a]\ntea: green\ntea: black\n---\nBody");

    expect(rows(page).slice(1)).toEqual([
      ["loop", "*a"],
      ["tea", "green"],
      ["tea", "black"],
    ]);
  });

  it.each([
    ["a list", "---\n- tea\n- cups\n---\nBody", "- tea"],
    ["broken YAML", "---\ntitle: [unclosed\n---\nBody", "title: [unclosed"],
  ])(
    "shows front matter that holds no properties as written: %s",
    (_, text, written) => {
      const page = show(text);

      expect(page.querySelector("table")).toBeNull();
      expect(page.querySelector("pre code")).toHaveTextContent(written);
      expect(screen.getByText("Body")).toBeVisible();
    },
  );

  it("shows nothing for empty front matter", () => {
    const page = show("---\n---\nBody");

    expect(page.querySelector("table, pre, hr")).toBeNull();
    expect(page).toHaveTextContent(/^Body$/);
  });
});
