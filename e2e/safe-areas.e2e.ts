import type { Locator, Page } from "@playwright/test";
import { expect, signIn, test } from "./fake-google.ts";

// A phone with a notch and a home bar, as Chromium alone can make one up.
test.use({ hasTouch: true, isMobile: true });
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Only Chromium makes up a screen's safe areas",
);

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// An iPhone 15's, held upright then sideways.
const UPRIGHT: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
const SIDEWAYS: Insets = { top: 0, right: 59, bottom: 21, left: 59 };
// An iPad's, with a status bar as an app of its own would draw under it.
const TABLET: Insets = { top: 24, right: 0, bottom: 20, left: 0 };

/** The space the app's bars and pages keep from what they hold. */
const PADDING = 16;

async function notch(page: Page, insets: Insets): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("Not shown");
  return found;
}

/** Checks that a control lies within the screen's safe area, by `space`. */
async function clear(
  page: Page,
  locator: Locator,
  insets: Insets,
  space = 0,
): Promise<void> {
  const { x, y, width, height } = await box(locator);
  const screen = page.viewportSize();
  if (!screen) throw new Error("No viewport");
  expect(x).toBeGreaterThanOrEqual(insets.left + space);
  expect(y).toBeGreaterThanOrEqual(insets.top);
  expect(x + width).toBeLessThanOrEqual(screen.width - insets.right - space);
  expect(y + height).toBeLessThanOrEqual(screen.height - insets.bottom);
}

/** The floating New note of a folder, once the folder has loaded. */
async function newNote(page: Page): Promise<Locator> {
  await page.getByRole("link", { name: "My Drive" }).first().click();
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Work", exact: true }).click();
  await expect(main.getByRole("link", { name: "plan.md" })).toBeVisible();
  return page.getByRole("button", { name: "New note" });
}

test("lets the page take the whole screen, notch and home bar included", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /(^|, )viewport-fit=cover(,|$)/,
  );
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
});

test("shrinks the page with Android's keyboard, so the note's end scrolls above it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /(^|, )interactive-widget=resizes-content(,|$)/,
  );
});

test("keeps the sign-in screen clear of the notch and the home bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await notch(page, UPRIGHT);
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
  await clear(page, main.locator("img").first(), UPRIGHT);
  await clear(
    page,
    main.getByRole("link", { name: "Privacy, terms and support" }),
    UPRIGHT,
  );
});

test("runs the app bar under the status bar, its content below it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await notch(page, UPRIGHT);
  await signIn(page);
  const bar = page.getByRole("banner");
  expect(await box(bar)).toMatchObject({ x: 0, y: 0, width: 393 });
  expect((await box(bar)).height).toBe(56 + UPRIGHT.top);
  await clear(page, bar.getByRole("link", { name: "DriveMD" }), UPRIGHT);
  await clear(page, bar.getByRole("button", { name: /^Account/ }), UPRIGHT);
  // The menu opens under the bar, not over it.
  await bar.getByRole("button", { name: /^Account/ }).click();
  const menu = page.getByRole("dialog", { name: "Account" });
  expect((await box(menu)).y).toBeGreaterThanOrEqual(56 + UPRIGHT.top - 8);
  await page.keyboard.press("Escape");
  await clear(page, await newNote(page), UPRIGHT);
});

test("keeps the bar's and the page's content clear of the notch, held sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await notch(page, SIDEWAYS);
  await signIn(page);
  const bar = page.getByRole("banner");
  // The bar's background still runs from edge to edge.
  expect(await box(bar)).toMatchObject({ x: 0, y: 0, width: 852 });
  await clear(
    page,
    bar.getByRole("link", { name: "DriveMD" }),
    SIDEWAYS,
    PADDING,
  );
  await clear(
    page,
    bar.getByRole("button", { name: /^Account/ }),
    SIDEWAYS,
    PADDING,
  );
  await clear(
    page,
    page.getByRole("region", { name: "Recent" }).getByRole("link").first(),
    SIDEWAYS,
    PADDING,
  );
  await clear(page, await newNote(page), SIDEWAYS, PADDING);
});

test("keeps a note's lines and the keyboard's keys clear of the notch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await notch(page, SIDEWAYS);
  await signIn(page);
  await page.goto("/edit?id=notes");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  const line = source.locator(".cm-line").first();
  await line.click();
  await clear(page, line, SIDEWAYS, PADDING);

  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  // Its background runs from edge to edge, down to the screen's bottom.
  expect(await box(toolbar)).toMatchObject({ x: 0, width: 852 });
  const { y, height } = await box(toolbar);
  expect(y + height).toBe(393);
  // It adds no home bar's inset under its keys: a phone shows it over the
  // keyboard, which covers the home bar, and the Home Screen app, whose
  // window the keyboard shrinks, would show the inset as an empty row. With
  // no keyboard up, as here, its keys sit over the home bar.
  expect(height).toBe(48);
  const sides = { ...SIDEWAYS, bottom: 0 };
  await clear(page, toolbar.getByRole("button").first(), sides);
  await clear(
    page,
    toolbar.getByRole("button", { name: "Find in note" }),
    sides,
  );

  // The note's end scrolls clear of it.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  // CodeMirror draws its lines afresh as the page scrolls.
  await expect
    .poll(async () => {
      const end = await source.locator(".cm-line").last().boundingBox();
      return end ? end.y + end.height : Infinity;
    })
    .toBeLessThanOrEqual(y);
});

test("keeps the folder's drawer clear of the status bar and the home bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await notch(page, TABLET);
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.getByRole("button", { name: "Folder" }).click();
  const drawer = page.getByRole("dialog", { name: "Work" });
  await expect(
    drawer.getByRole("link", { name: "Work", exact: true }),
  ).toBeVisible();
  // It runs the screen's height, what it holds inside the safe area.
  await expect(drawer).toHaveCSS(
    "padding-top",
    `${String(PADDING + TABLET.top)}px`,
  );
  await expect(drawer).toHaveCSS(
    "padding-bottom",
    `${String(PADDING + TABLET.bottom)}px`,
  );
  await page.keyboard.press("Escape");
});
