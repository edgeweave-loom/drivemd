import { touchScreen } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("renders a note of a vault as Obsidian does", async ({ page }) => {
  await signIn(page);
  await page.goto("/edit?id=today");

  const note = page.locator(".markdown");
  // A single line break shows as one, as the vault's settings leave it.
  await expect(note.locator("p").first()).toHaveText(
    "Woke up early.\nMade tea.",
  );
  await expect(note.locator("p br")).toHaveCount(1);
  // A checked task is struck through, as in Obsidian.
  await expect(note.getByRole("listitem").first()).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await expect(note.getByRole("listitem").nth(1)).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  // Highlights and tags show, comments and block IDs do not.
  const tea = note.locator("p#user-content-\\^tea");
  await expect(tea).toHaveText("Green tea for #morning done.1");
  await expect(tea.locator("mark")).toHaveCSS(
    "background-color",
    "rgba(255, 208, 0, 0.4)",
  );
  await expect(tea.locator(".tag")).toHaveText("#morning");
  // An embedded image, found by name in the vault, at the size it gives.
  const pixel = note.getByRole("img", { name: "pixel.png" });
  await pixel.scrollIntoViewIfNeeded();
  await expect(pixel).toHaveAttribute("src", /^blob:/);
  await expect(pixel).toHaveAttribute("width", "40");
  await expect
    .poll(() => pixel.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  // An embedded note shows the section it names, with a link to the note.
  const embed = note.locator(".embed");
  await embed.scrollIntoViewIfNeeded();
  await expect(embed.getByText("Wait.")).toBeVisible();
  await expect(
    embed.getByRole("link", { name: "guide > Brewing" }),
  ).toHaveAttribute("href", "/edit?id=guide#brewing");
  // An inline footnote shows among the note's footnotes.
  await expect(note.locator("section[data-footnotes] li")).toContainText(
    "From Japan.",
  );
  // A folded callout, in its type's color, opens with a tap on its title,
  // whose chevron turns from right to down, as in Obsidian.
  const callout = note.locator(".callout");
  const summary = callout.locator("summary");
  const fold = summary.locator(".callout-fold");
  const turn = () =>
    fold.evaluate((chevron) => {
      const { a, b } = new DOMMatrix(getComputedStyle(chevron).transform);
      return Math.round((Math.atan2(b, a) * 180) / Math.PI);
    });
  await expect(callout).toHaveCSS("border-left-color", "rgb(0, 191, 188)");
  await expect(callout.getByText("Water at 90 °C.")).toBeHidden();
  await expect(fold).toHaveAttribute("data-icon", "lucide-chevron-down");
  await expect.poll(turn).toBe(-90);
  // The chevron stands for the browser's marker: the title starts with its
  // type's icon.
  const start = await summary.evaluate((title) => {
    const { left } = title.getBoundingClientRect();
    return left + parseFloat(getComputedStyle(title).paddingLeft);
  });
  expect((await summary.locator(".callout-icon").boundingBox())?.x).toBeCloseTo(
    start,
    0,
  );
  await callout.getByText("Brew it hot").click();
  await expect(callout.getByText("Water at 90 °C.")).toBeVisible();
  await expect.poll(turn).toBe(0);
  const title = await summary.boundingBox();
  expect(title?.height).toBeGreaterThanOrEqual(44);
  // Its title starts with its type's icon, at the text's size, in the type's
  // color in either theme; both icons sit on the title's first line.
  const icon = summary.locator(".callout-icon");
  await expect(icon).toHaveAttribute("data-icon", "lucide-flame");
  await expect(icon).toHaveCSS("stroke", "rgb(0, 191, 188)");
  const size = await icon.boundingBox();
  const text = await summary.evaluate((title) => {
    const style = getComputedStyle(title);
    return {
      size: parseFloat(style.fontSize),
      line: parseFloat(style.lineHeight),
    };
  });
  expect(size?.width).toBeCloseTo(text.size, 0);
  expect(size?.height).toBeCloseTo(text.line, 0);
  expect((await fold.boundingBox())?.y).toBeCloseTo(size?.y ?? NaN);
  await page.emulateMedia({ colorScheme: "dark" });
  // A computer keeps the light theme.
  await expect(icon).toHaveCSS(
    "stroke",
    (await touchScreen(page)) ? "rgb(83, 223, 221)" : "rgb(0, 191, 188)",
  );
});

test("opens the note an internal link names, at its heading", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=today");

  const note = page.locator(".markdown");
  await expect(note.getByText("Nowhere")).toHaveClass("unresolved");
  await note.getByRole("link", { name: "the guide" }).click();
  await expect(page).toHaveURL(/\/edit\?id=guide#brewing$/);
  await expect(
    page.locator(".markdown").getByRole("heading", { name: "Brewing" }),
  ).toBeInViewport();
});
