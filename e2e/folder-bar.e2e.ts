import { token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("names the folder in a phone's app bar, with a way up to the one above", async ({
  page,
}, info) => {
  await signIn(page);
  const bar = page.getByRole("banner");
  await page.getByRole("link", { name: "My Drive" }).first().click();
  if (info.project.metadata.layout !== "phone") {
    // A wider screen keeps DriveMD's mark, beside the drawer or the rail.
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    return;
  }
  await expect(bar.getByRole("heading", { name: "My Drive" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "DriveMD" })).toBeHidden();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  await expect(bar.getByRole("heading", { name: "Work" })).toBeVisible();
  // The breadcrumbs stay under the bar.
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link"),
  ).toHaveText(["Home", "My Drive"]);

  await bar.getByRole("link", { name: "Back to My Drive" }).click();
  await expect(bar.getByRole("heading", { name: "My Drive" })).toBeVisible();
  await bar.getByRole("link", { name: "Back to Home" }).click();
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
});

test("offers New note as a floating button on a phone", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  const create = page.getByRole("button", { name: "New note" });
  await expect(create.locator('svg[data-icon="add"]')).toHaveCount(1);
  if (info.project.metadata.layout !== "phone") {
    await expect(create).toHaveCSS(
      "background-color",
      await token(page, "--secondary-container"),
    );
    return;
  }
  await expect(create).toHaveCSS("position", "fixed");
  await expect(create).toHaveCSS(
    "background-color",
    await token(page, "--primary-container"),
  );
  const box = await create.boundingBox();
  const screen = page.viewportSize();
  if (!box || !screen) throw new Error("Not shown");
  expect(box.height).toBe(56);
  expect(screen.width - (box.x + box.width)).toBe(16);
  expect(screen.height - (box.y + box.height)).toBeGreaterThanOrEqual(16);
});

test("shows breadcrumbs on folder pages only", async ({ page }) => {
  await signIn(page);
  await page.goto("/shortcuts");
  await expect(
    page.getByRole("main").getByRole("link", { name: /Plan shortcut/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }),
  ).toHaveCount(0);
});
