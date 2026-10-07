import { token } from "./color.ts";
import { EMAIL, expect, signIn, test } from "./fake-google.ts";

test("names the app beside its mark, and leads Home from any page", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  const bar = page.getByRole("banner");
  const phone = info.project.metadata.layout === "phone";
  expect((await bar.boundingBox())?.height).toBe(phone ? 56 : 64);
  const mark = bar.locator('img[src="/icon.svg"]');
  await expect(mark).toHaveAttribute("alt", "");
  expect((await mark.boundingBox())?.width).toBe(phone ? 32 : 40);
  await bar.getByRole("link", { name: "DriveMD" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

test("shows the account as its initial, and a menu with its address, the about page and Sign out", async ({
  page,
}) => {
  await signIn(page);
  const account = page
    .getByRole("banner")
    .getByRole("button", { name: `Account, ${EMAIL}` });
  await expect(account).toHaveText("A");
  await expect(account).toHaveCSS(
    "background-color",
    await token(page, "--primary-container"),
  );
  expect((await account.boundingBox())?.width).toBe(32);

  await account.click();
  const menu = page.getByRole("dialog", { name: "Account" });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(EMAIL);
  // The offer of the source that the AGPL asks for, one tap away.
  const about = menu.getByRole("link", { name: "About DriveMD" });
  await expect(about).toHaveAttribute("href", "/about.html");
  await expect(about).toHaveAttribute("target", "_blank");
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
  // It opens under the button, its edge lined up with the button's.
  const button = await account.boundingBox();
  const box = await menu.boundingBox();
  if (!button || !box) throw new Error("Not shown");
  expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(box.y).toBeLessThanOrEqual(button.y + button.height + 16);
  expect(box.x + box.width).toBeCloseTo(button.x + button.width, 0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The about page opens in a tab of its own, and the menu closes.
  await account.click();
  const opened = page.context().waitForEvent("page");
  await about.click();
  await (await opened).close();
  await expect(menu).toBeHidden();
});

test("gives the focus back to the account when the user stays signed in", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  const account = page.getByRole("button", { name: `Account, ${EMAIL}` });
  await account.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(account).toBeFocused();
});

test("signs out from the account's menu", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: `Account, ${EMAIL}` }).click();
  await page
    .getByRole("dialog", { name: "Account" })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

test("searches from a pill, which rises while it has the focus", async ({
  page,
}, info) => {
  test.skip(
    info.project.metadata.layout === "phone",
    "A phone searches full screen.",
  );
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeHidden();
  const field = page.getByRole("searchbox", {
    name: "Search Markdown files by name",
  });
  const search = page.getByRole("search");
  await expect(search.locator("svg:visible")).toHaveCount(1);
  expect((await field.boundingBox())?.height).toBe(48);
  await expect(field).toHaveCSS(
    "background-color",
    await token(page, "--surface-container-high"),
  );
  await field.focus();
  await expect(field).toHaveCSS(
    "background-color",
    await token(page, "--sheet"),
  );
  await expect(field).not.toHaveCSS("box-shadow", "none");
  // And shows the keyboard's focus as every control does.
  await expect(field).toHaveCSS("outline-style", "solid");
});

test("searches full screen on a phone, with Back and Clear", async ({
  page,
}, info) => {
  test.skip(
    info.project.metadata.layout !== "phone",
    "A wide screen keeps the search bar in the app bar.",
  );
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  const bar = page.getByRole("banner");
  const field = page.getByRole("searchbox", {
    name: "Search Markdown files by name",
  });
  await expect(field).toBeHidden();
  await bar.getByRole("button", { name: "Search", exact: true }).click();
  // At once, so that the phone's keyboard comes up with the tap.
  await expect(field).toBeFocused();
  await expect(page).toHaveURL(/\/search\?q=$/);
  await expect(bar).toHaveCSS(
    "background-color",
    await token(page, "--surface-container-high"),
  );
  await expect(bar.getByRole("link", { name: "DriveMD" })).toBeHidden();
  await expect(bar.getByRole("button", { name: /^Account, / })).toBeHidden();

  await field.fill("pla");
  await field.press("Enter");
  await expect(
    page.getByRole("main").getByRole("link").locator(".name"),
  ).toHaveText(["plan.md"]);
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(page).toHaveURL(/\/search\?q=pla$/);

  // Back leaves the search at once, to the page that opened it.
  await bar.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/my-drive$/);
  await expect(field).toBeHidden();
});
