import { touchScreen } from "./color.ts";
import { EMAIL, expect, signIn, test } from "./fake-google.ts";

test("says how DriveMD treats data, its terms, where to get help and its source, signed out", async ({
  page,
}) => {
  const response = await page.goto("/about.html#support");
  // The Marketplace listing links here, under the policy production sends.
  expect(response?.headers()["content-security-policy"]).toContain(
    "require-trusted-types-for 'script'",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "About DriveMD" }),
  ).toBeVisible();
  for (const [part, name] of [
    ["privacy", "Privacy"],
    ["terms", "Terms of service"],
    ["support", "Support"],
    ["source", "Source code"],
  ] as const) {
    await expect(
      page.locator(`#${part}`).getByRole("heading", { level: 2, name }),
    ).toBeVisible();
  }
  await expect(
    page.locator("#support").getByRole("link", { name: "GitHub issues" }),
  ).toHaveAttribute("href", "https://github.com/edgeweave-loom/drivemd/issues");
  // The offer of the source that the AGPL asks of a modified version served
  // to users.
  await expect(
    page.locator("#source").getByRole("link", { name: "source code" }),
  ).toHaveAttribute("href", "https://github.com/edgeweave-loom/drivemd");
  await expect(
    page.locator("#source").getByRole("link", { name: "license", exact: true }),
  ).toHaveAttribute("href", "https://www.gnu.org/licenses/agpl-3.0.html");
  // The icons in the app's pages come under a license of their own, which
  // asks to be given with them.
  await expect(
    page.locator("#source").getByRole("link", { name: "Material Symbols" }),
  ).toHaveAttribute("href", "https://github.com/google/material-design-icons");
  await expect(
    page.locator("#source").getByRole("link", { name: "Apache License 2.0" }),
  ).toHaveAttribute("href", "https://www.apache.org/licenses/LICENSE-2.0");
  // So do its fonts.
  for (const [name, href] of [
    ["Google Sans Flex", "https://fonts.google.com/specimen/Google+Sans+Flex"],
    ["Google Sans Code", "https://github.com/googlefonts/googlesans-code"],
  ] as const) {
    await expect(
      page.locator("#source").getByRole("link", { name }),
    ).toHaveAttribute("href", href);
  }
  await expect(
    page
      .locator("#source")
      .getByRole("link", { name: "SIL Open Font License" }),
  ).toHaveAttribute("href", "https://openfontlicense.org");
  // Styled by the app's own stylesheet, which the policy allows.
  await expect(page.getByRole("main")).toHaveCSS("max-width", "768px");
  // Close starts where the text does, as wide as its label.
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  const close = await page.getByRole("button", { name: "Close" }).boundingBox();
  if (!heading || !close) throw new Error("Not shown");
  expect(close.x).toBeCloseTo(heading.x, 0);
  expect(close.width).toBeLessThan(heading.width);
});

test("goes back to the sign-in screen with Close", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Privacy, terms and support" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

test("closes the tab that the account's menu opened, even after a visit elsewhere", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("banner")
    .getByRole("button", { name: `Account, ${EMAIL}` })
    .click();
  const opened = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "About DriveMD" }).click();
  const tab = await opened;
  await expect(
    tab.getByRole("heading", { level: 1, name: "About DriveMD" }),
  ).toBeVisible();
  // A page ahead in the history leaves nothing to go back to.
  await tab.goto("/");
  await tab.goBack();
  const closed = tab.waitForEvent("close");
  // The tab may close before Playwright sees the click through, which it
  // then reports as failed: only a tab still open is a failure.
  await tab
    .getByRole("button", { name: "Close" })
    .click()
    .catch((error: unknown) => {
      if (!tab.isClosed()) throw error;
    });
  await closed;
});

test("opens the app with Close where the tab can neither go back nor close", async ({
  page,
}) => {
  // Opened after the browser's blank page, which is not DriveMD's own.
  await page.goto("/about.html");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("leaves the page readable, leading into the app, and the Close button out", async ({
    page,
  }) => {
    await page.goto("/about.html");
    await expect(
      page.getByRole("heading", { level: 1, name: "About DriveMD" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeHidden();
    // The way into the app, for whoever comes from the Marketplace listing.
    await expect(
      page.getByRole("link", { name: "sign in to DriveMD" }),
    ).toHaveAttribute("href", "/");
  });
});

test("leads there from the sign-in screen", async ({ page }) => {
  await page.goto("/");
  // Once Google's sign-in script has loaded, so that nothing is left loading.
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Privacy, terms and support" }).click();
  await expect(page).toHaveURL(/\/about\.html$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "About DriveMD" }),
  ).toBeVisible();
});

test("shows DriveMD's icon in the browser's tab, on both pages", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg",
  );
  // Once Google's sign-in script has loaded, so that nothing is left loading.
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
  await page.goto("/about.html");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg",
  );
  // Drawn as an image, under the policy's img-src.
  const width = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const icon = new Image();
        icon.onload = () => {
          resolve(icon.naturalWidth);
        };
        icon.onerror = () => {
          resolve(0);
        };
        icon.src = "/icon.svg";
      }),
  );
  expect(width).toBeGreaterThan(0);
});

test("keeps the light theme on a computer, as the app does", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/about.html");
  await expect(
    page.getByRole("heading", { level: 1, name: "About DriveMD" }),
  ).toBeVisible();
  // The on-surface token's light value, or on a touch screen its dark one.
  await expect(page.locator(":root")).toHaveCSS(
    "color",
    (await touchScreen(page)) ? "rgb(224, 227, 230)" : "rgb(24, 28, 30)",
  );
});
