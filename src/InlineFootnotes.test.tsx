import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Rendered } from "./Markdown.tsx";
import { VAULT } from "./test/vault.ts";

/** Renders a note of a vault, with Obsidian's default settings. */
function show(text: string) {
  return render(<Rendered text={text} vault={VAULT} />).container;
}

/** The text an element shows, its blocks one space apart. */
function shown(element: Element | null) {
  return element?.textContent.replace(/\s+/g, " ").trim() ?? "";
}

/** Each footnote's text, without its link back, in the order they show. */
function footnotes(page: HTMLElement) {
  return [...page.querySelectorAll("section[data-footnotes] li")].map((item) =>
    shown(item).replace(/ ?↩$/, ""),
  );
}

describe("inline footnotes in a note of a vault", () => {
  it("show as footnotes", () => {
    const page = show("Tea^[Green, from Japan.] is hot.");

    expect(shown(page.querySelector("p"))).toBe("Tea1 is hot.");
    expect(page.querySelector("p sup a")).toHaveAttribute(
      "href",
      "#user-content-fn-inline-1",
    );
    expect(footnotes(page)).toEqual(["Green, from Japan."]);
  });

  it("take their turn among the note's other footnotes", () => {
    const page = show("A[^x] B^[inline] C[^y]\n\n[^x]: X\n[^y]: Y");

    expect(shown(page.querySelector("p"))).toBe("A1 B2 C3");
    expect(footnotes(page)).toEqual(["X", "inline", "Y"]);
  });

  it("keep their Markdown, and the brackets they hold", () => {
    const page = show(
      "Tea^[a **strong** [link](https://example.com), [this] and #tag]",
    );

    const [note] = page.querySelectorAll("section[data-footnotes] li");
    expect(footnotes(page)).toEqual(["a strong link, [this] and #tag"]);
    expect(note?.querySelector("strong")).toHaveTextContent("strong");
    expect(note?.querySelector("a[href^='https']")).toHaveTextContent("link");
    expect(note?.querySelector(".tag")).toHaveTextContent("#tag");
  });

  it("take a name the note's own footnotes do not", () => {
    const page = show("A[^inline-1] B^[mine]\n\n[^inline-1]: theirs");

    expect(footnotes(page)).toEqual(["theirs", "mine"]);
  });

  it.each([
    ["escaped", "Tea\\^[not a note]"],
    ["with an escaped bracket", "Tea^\\[not a note]"],
    ["never closed", "Tea^[not a note"],
    ["in a link's text", "[Tea^[not a note]](https://example.com)"],
  ])("are none when %s", (_, text) => {
    const page = show(text);

    expect(page.querySelector("section[data-footnotes]")).toBeNull();
    expect(shown(page)).toContain("^[not a note");
  });
});

describe("a note outside a vault", () => {
  it("shows an inline footnote as written", () => {
    const page = render(<Rendered text="Tea^[Green.]" />).container;

    expect(shown(page)).toBe("Tea^[Green.]");
  });
});
