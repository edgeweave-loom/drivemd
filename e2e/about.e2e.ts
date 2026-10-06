import { expect, test } from "./fake-google.ts";

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
    page.locator("#source").getByRole("link", { name: "license" }),
  ).toHaveAttribute("href", "https://www.gnu.org/licenses/agpl-3.0.html");
  // Styled by the app's own stylesheet, which the policy allows, and
  // running no script.
  await expect(page.getByRole("main")).toHaveCSS("max-width", "768px");
  await expect(page.locator("script")).toHaveCount(0);
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
