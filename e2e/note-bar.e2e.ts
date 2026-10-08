import { expect, signIn, test } from "./fake-google.ts";

test("names the note in the app bar, with what it lets the user do", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Work", exact: true }).click();
  await main.getByRole("link", { name: "plan.md" }).click();

  const bar = page.getByRole("banner");
  await expect(bar.getByRole("heading", { level: 1 })).toHaveText("plan.md");
  const changed = bar.getByText(/^Last modified by Ada Lovelace on /);
  const account = bar.getByRole("button", { name: /^Account, / });
  // The note's bar holds no search, and the page no breadcrumbs.
  await expect(bar.getByRole("search")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }),
  ).toHaveCount(0);

  await page.locator(".markdown").getByRole("checkbox").first().check();
  await expect(bar.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Edit" })).toBeVisible();
  const unsaved = bar.getByText("Unsaved changes");

  if (info.project.metadata.layout === "phone") {
    // A way up to the note's folder, in place of DriveMD's mark, and neither
    // the last change nor the account, which Home holds.
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeHidden();
    await expect(bar.getByRole("link", { name: "Back to Work" })).toBeVisible();
    await expect(changed).toBeHidden();
    await expect(account).toHaveCount(0);
    // Save says by showing that changes are unsaved, leaving the name room.
    await expect(unsaved).toBeHidden();
    const whole = await bar
      .getByRole("heading", { level: 1 })
      .evaluate((name) => name.scrollWidth <= name.clientWidth);
    expect(whole).toBe(true);
  } else {
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    await expect(changed).toBeVisible();
    await expect(account).toBeVisible();
    await expect(unsaved).toBeVisible();
  }
});

test("offers Move by the note's name and the rest in More actions", async ({
  page,
  browserName,
}, info) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  const name = bar.getByRole("heading", { level: 1, name: "plan.md" });
  await expect(name).toBeVisible();
  const phone = info.project.metadata.layout === "phone";

  // Beside the name, but on a phone, whose bar has no room for it.
  const move = bar.getByRole("button", { name: "Move", exact: true });
  await expect(move).toBeVisible({ visible: !phone });
  await expect(move.locator('svg[data-icon="drive_file_move"]')).toHaveCount(
    phone ? 0 : 1,
  );
  if (!phone) {
    const [named, moved] = await Promise.all([
      name.boundingBox(),
      move.boundingBox(),
    ]);
    expect(moved?.x).toBeGreaterThan((named?.x ?? 0) + (named?.width ?? 0));
  }

  const more = bar.getByRole("button", { name: "More actions" });
  await expect(more.locator('svg[data-icon="more_vert"]')).toHaveCount(1);
  await more.click();
  const menu = page.getByRole("dialog", { name: "More actions" });
  await expect(menu.getByRole("button")).toHaveText(
    phone ? ["Rename", "Move", "Move to trash"] : ["Rename", "Move to trash"],
  );
  const box = await menu.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );

  // The menu closes as the dialog opens.
  await menu.getByRole("button", { name: "Rename" }).click();
  await expect(menu).toBeHidden();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await expect(rename.getByRole("textbox", { name: "Name" })).toHaveValue(
    "plan.md",
  );
  await rename.getByRole("button", { name: "Cancel" }).click();
  await expect(rename).toHaveCount(0);
  // Chromium focuses what a click presses, which then gives the focus back
  // to More actions once both the menu and the dialog are gone.
  if (browserName === "chromium") await expect(more).toBeFocused();
});
