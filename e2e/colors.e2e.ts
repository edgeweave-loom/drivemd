import { contrast, token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

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
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.goto("/edit?id=plan");
    const note = page.locator(".markdown");
    await expect(
      note.getByRole("heading", { level: 1, name: "The plan" }),
    ).toBeVisible();

    const surface = await token(page, "--surface");
    const root = page.locator(":root");
    // A phone runs on the surface; a wider screen raises the note's sheet
    // over the app's background.
    await expect(root).toHaveCSS(
      "background-color",
      info.project.metadata.layout === "phone"
        ? surface
        : await token(page, "--app-background"),
    );
    await expect(root).toHaveCSS("color", await token(page, "--on-surface"));
    await expect(note.getByRole("link", { name: "the docs" })).toHaveCSS(
      "color",
      await token(page, "--primary"),
    );
    // The browser's bars, and Android's launch screen, take a phone's
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

test("marks what the user's version adds and removes, not by color alone", async ({
  page,
  drive,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  // Once the note shows, someone else saves it.
  await expect(
    page.locator(".markdown").getByRole("checkbox").first(),
  ).toBeVisible();
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = `${String(plan.content)}\nTheir line.\n`;
  plan.revision = 2;
  // Ticked while viewing, a task saves at once, which finds their change.
  await page.locator(".markdown").getByRole("checkbox").first().check();

  const differences = page.locator(".differences");
  // "- [ ] Boil water" became "- [x] Boil water": only the box changed.
  const removed = differences
    .locator(".cm-deletedChunk")
    .filter({ hasText: "Boil water" });
  const added = differences
    .locator(".cm-changedLine")
    .filter({ hasText: "Boil water" });
  await expect(removed.locator(".cm-deletedText")).toHaveText(" ");
  await expect(removed.locator(".cm-deletedText")).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await expect(added.locator(".cm-changedText")).toHaveText("x");
  await expect(added.locator(".cm-changedText")).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  // The rest of each line is as it was, on the line's color.
  await expect(removed.locator("del")).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await expect(added).toHaveCSS("text-decoration-line", "none");
  await expect(removed).toHaveCSS(
    "background-color",
    await token(page, "--diff-removed"),
  );
  await expect(added).toHaveCSS(
    "background-color",
    await token(page, "--diff-added"),
  );
});
