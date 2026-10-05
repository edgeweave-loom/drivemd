import { expect, test } from "./fake-google.ts";

test("says how DriveMD treats data, its terms and where to get help, signed out", async ({
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
  ] as const) {
    await expect(
      page.locator(`#${part}`).getByRole("heading", { level: 2, name }),
    ).toBeVisible();
  }
  await expect(
    page.locator("#support").getByRole("link", { name: "GitHub issues" }),
  ).toHaveAttribute("href", "https://github.com/edgeweave-loom/drivemd/issues");
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
