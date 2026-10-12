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
  await tab.getByRole("button", { name: "Close" }).click();
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

  test("leaves the page readable and the Close button out", async ({
    page,
  }) => {
    await page.goto("/about.html");
    await expect(
      page.getByRole("heading", { level: 1, name: "About DriveMD" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Open DriveMD" }),
    ).toBeVisible();
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
