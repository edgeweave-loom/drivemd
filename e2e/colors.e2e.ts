import { contrast, token, touchScreen } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

/** A `#rrggbb` color as browsers compute it. */
function rgb(hex: string | null | undefined): string {
  const [r, g, b] = [1, 3, 5].map((at) =>
    String(Number.parseInt(hex?.slice(at, at + 2) ?? "", 16)),
  );
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

// The surface token's light and dark values (src/tokens.css).
const SURFACE = { light: "#f7f9fd", dark: "#101416" };

// Each of the system's themes, then the dark one on a touch screen in
// Chromium, as on Android: the other projects are WebKit touch screens.
for (const [scheme, touch] of [
  ["light", false],
  ["dark", false],
  ["dark", true],
] as const) {
  test.describe(
    touch ? "on a Chromium touch screen" : "on the project's screen",
    () => {
      if (touch) test.use({ hasTouch: true });

      test(`takes the design's colors with the system in the ${scheme} theme`, async ({
        page,
        request,
        browserName,
      }, info) => {
        test.skip(
          touch && browserName !== "chromium",
          "A touch screen already",
        );
        await page.emulateMedia({ colorScheme: scheme });
        await signIn(page);
        await page.goto("/edit?id=plan");
        const note = page.locator(".markdown");
        await expect(
          note.getByRole("heading", { level: 1, name: "The plan" }),
        ).toBeVisible();

        // A computer keeps the light theme, as Google Docs does on the web; a
        // touch screen follows the system's.
        const surface = await token(page, "--surface");
        expect(surface).toBe(
          rgb(SURFACE[(await touchScreen(page)) ? scheme : "light"]),
        );
        const root = page.locator(":root");
        // A phone runs on the surface; a wider screen raises the note's sheet
        // over the app's background.
        await expect(root).toHaveCSS(
          "background-color",
          info.project.metadata.layout === "phone"
            ? surface
            : await token(page, "--app-background"),
        );
        await expect(root).toHaveCSS(
          "color",
          await token(page, "--on-surface"),
        );
        await expect(note.getByRole("link", { name: "the docs" })).toHaveCSS(
          "color",
          await token(page, "--primary"),
        );
        // The browser's bars, and Android's launch screen, take a phone's
        // background.
        const bars = await page
          .locator('meta[name="theme-color"]')
          .evaluateAll((metas) =>
            metas
              .filter(
                (meta): meta is HTMLMetaElement =>
                  meta instanceof HTMLMetaElement &&
                  matchMedia(meta.media).matches,
              )
              .map((meta) => meta.content),
          );
        expect(bars.map(rgb)).toEqual([surface]);
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
          const kinds = [
            "keyword",
            "string",
            "attr",
            "comment",
            "meta",
            "title",
          ];
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
    },
  );
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
