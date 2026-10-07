import type { Page } from "@playwright/test";
import { contrast } from "./contrast.ts";
import { expect, signIn, test } from "./fake-google.ts";

/** A token of src/tokens.css, as the page computes it in its theme. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate((name) => {
    // Set through the CSSOM, which the security policy allows, where it
    // refuses a style attribute.
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

/** A `#rrggbb` color as browsers compute it. */
function rgb(hex: string | null | undefined): string {
  const [r, g, b] = [1, 3, 5].map((at) =>
    String(Number.parseInt(hex?.slice(at, at + 2) ?? "", 16)),
  );
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

for (const scheme of ["light", "dark"] as const) {
  test(`takes the design's colors in the ${scheme} theme`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.goto("/edit?id=plan");
    const note = page.locator(".markdown");
    await expect(
      note.getByRole("heading", { level: 1, name: "The plan" }),
    ).toBeVisible();

    const surface = await token(page, "--surface");
    const root = page.locator(":root");
    await expect(root).toHaveCSS("background-color", surface);
    await expect(root).toHaveCSS("color", await token(page, "--on-surface"));
    await expect(note.getByRole("link", { name: "the docs" })).toHaveCSS(
      "color",
      await token(page, "--primary"),
    );
    // The browser's bars, and Android's launch screen, take the page's
    // background.
    const bar = await page
      .locator(
        `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
      )
      .getAttribute("content");
    expect(rgb(bar)).toBe(surface);
    if (scheme === "light") {
      const manifest = (await (
        await request.get("/manifest.webmanifest")
      ).json()) as { background_color: string; theme_color: string };
      expect(rgb(manifest.background_color)).toBe(surface);
      expect(rgb(manifest.theme_color)).toBe(surface);
    }

    // Highlighted code reads on its block, in every role it takes.
    const colors = await note.locator("pre").evaluate((pre) => {
      const code = pre.querySelector("code");
      if (!code) throw new Error("No code");
      const kinds = ["keyword", "string", "attr", "comment", "meta", "title"];
      const spans = kinds.map((kind) => {
        const span = code.appendChild(document.createElement("span"));
        span.className = `hljs-${kind}`;
        span.textContent = kind;
        return span;
      });
      const shown = spans.map((span) => getComputedStyle(span).color);
      for (const span of spans) span.remove();
      return { block: getComputedStyle(pre).backgroundColor, shown };
    });
    for (const color of colors.shown) {
      expect(contrast(color, colors.block)).toBeGreaterThanOrEqual(5);
    }
    await expect(note.locator("pre .hljs-keyword")).toHaveCSS(
      "color",
      await token(page, "--primary"),
    );
  });
}
