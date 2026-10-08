import { token } from "./color.ts";
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
  const edit = page.getByRole("button", { name: "Edit" });
  const unsaved = bar.getByText("Unsaved changes");

  if (info.project.metadata.layout === "phone") {
    // A way up to the note's folder, in place of DriveMD's mark, and neither
    // the last change nor the account, which Home holds.
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeHidden();
    await expect(bar.getByRole("link", { name: "Back to Work" })).toBeVisible();
    await expect(changed).toBeHidden();
    await expect(account).toHaveCount(0);
    // Edit floats over the note, at the bottom right.
    await expect(bar.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(edit).toBeVisible();
    const box = await edit.boundingBox();
    const screen = page.viewportSize();
    if (!box || !screen) throw new Error("Edit has no place on the screen");
    expect(box.x + box.width).toBeGreaterThan(screen.width - 48);
    expect(box.y + box.height).toBeGreaterThan(screen.height - 48);
    // Save says by showing that changes are unsaved, leaving the name room.
    await expect(unsaved).toBeHidden();
    const whole = await bar
      .getByRole("heading", { level: 1 })
      .evaluate((name) => name.scrollWidth <= name.clientWidth);
    expect(whole).toBe(true);
  } else {
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(changed).toBeVisible();
    await expect(account).toBeVisible();
    await expect(unsaved).toBeVisible();
  }
});

test("offers Move by the note's name and the rest in More actions", async ({
  page,
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
    phone ? ["Move", "Move to trash"] : ["Move to trash"],
  );
  const box = await menu.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );

  // The menu closes as the dialog opens, which gives the focus back to More
  // actions once it goes.
  await menu.getByRole("button", { name: "Move to trash" }).click();
  await expect(menu).toBeHidden();
  const trash = page.getByRole("dialog", { name: "Move to trash?" });
  await trash.getByRole("button", { name: "Cancel" }).click();
  await expect(trash).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("renames the note by its name, its ending set apart", async ({
  page,
  drive,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  const name = bar.getByRole("button", { name: "plan.md" });
  // It reads as text, its ending dimmer.
  await expect(name).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(name.locator(".ending")).toHaveCSS(
    "color",
    await token(page, "--on-surface-variant"),
  );

  await name.click();
  const field = bar.getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("plan");
  // As wide as what it holds.
  const short = (await field.boundingBox())?.width ?? 0;
  await field.fill("the plan for the week");
  expect((await field.boundingBox())?.width).toBeGreaterThan(short);
  await field.press("Escape");
  await expect(name).toBeFocused();

  await name.click();
  await field.fill("roadmap");
  await field.press("Enter");
  await expect(bar.getByRole("button", { name: "roadmap.md" })).toBeFocused();
  expect(drive.writes).toEqual(["rename plan roadmap.md"]);
});
