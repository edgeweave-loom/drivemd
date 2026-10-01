import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rendered } from "./Markdown.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const deep = `${">".repeat(5_000)} Tea`;
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

  it("shows raw HTML as written, never running it", () => {
    const page = show("<b>bold</b> <script>alert(1)</script>");

    expect(page.querySelector("b, script")).toBeNull();
    expect(screen.getByText(/<b>bold<\/b>/)).toBeVisible();
  });
});
