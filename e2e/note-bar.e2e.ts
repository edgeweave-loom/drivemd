import type { Route } from "@playwright/test";
import { token } from "./color.ts";
import {
  expect,
  signIn,
  startEditing,
  test,
  tickWhileEditing,
} from "./fake-google.ts";

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

  await expect(bar.getByRole("button", { name: "Saved" })).toBeVisible();
  const edit = page.getByRole("button", { name: "Edit" });

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
    // The name keeps room beside the tools.
    const whole = await bar
      .getByRole("heading", { level: 1 })
      .evaluate((name) => name.scrollWidth <= name.clientWidth);
    expect(whole).toBe(true);
  } else {
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    // The mode menu takes the place of Edit.
    await expect(bar.getByRole("button", { name: "Viewing" })).toBeVisible();
    await expect(changed).toBeVisible();
    await expect(account).toBeVisible();
  }
});

test("switches between Editing and Viewing from the mode menu, saving first", async ({
  page,
  drive,
}, info) => {
  test.skip(
    info.project.metadata.layout === "phone",
    "a phone floats Edit and keeps Done",
  );
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  const mode = bar.getByRole("button", { name: "Viewing" });
  await mode.click();
  const menu = page.getByRole("menu", { name: "Mode" });
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    /^Editing\s*Edit the Markdown beside its preview$/,
    /^Viewing\s*Save, then read the note$/,
  ]);
  // It drops from its button.
  const [button, opened] = await Promise.all([
    mode.boundingBox(),
    menu.boundingBox(),
  ]);
  if (!button || !opened) throw new Error("The menu has no place");
  expect(opened.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(Math.abs(opened.x - button.x)).toBeLessThan(2);
  expect(opened.x + opened.width).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );

  await menu.getByRole("menuitemradio", { name: "Editing" }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Tea.");
  await bar.getByRole("button", { name: "Editing" }).click();
  await menu.getByRole("menuitemradio", { name: "Viewing" }).click();
  await expect(bar.getByRole("button", { name: "Viewing" })).toBeVisible();
  await expect(source).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
});

test("ends a phone's editing with a check in place of Back, which saves first", async ({
  page,
  drive,
}, info) => {
  test.skip(
    info.project.metadata.layout !== "phone",
    "a wider screen has the mode menu",
  );
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  const back = bar.getByRole("link", { name: "Back to Work" });
  await expect(back).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const done = bar.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();
  await expect(back).toBeHidden();
  const [checked, named] = await Promise.all([
    done.boundingBox(),
    bar.getByRole("heading", { level: 1 }).boundingBox(),
  ]);
  if (!checked || !named) throw new Error("The bar has no place for them");
  expect(checked.x).toBeLessThan(named.x);

  await page.getByRole("textbox", { name: "Markdown source" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Tea.");
  await done.click();
  await expect(bar.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(back).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
});

test("says at once that a save cannot reach Drive while offline", async ({
  page,
  drive,
}, info) => {
  const phone = info.project.metadata.layout === "phone";
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  await startEditing(page);
  await page.getByRole("textbox", { name: "Markdown source" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Tea.");
  await page.context().setOffline(true);
  // Chromium lets a route answer offline; Drive itself could not.
  const unreachable = (route: Route) => route.abort("internetdisconnected");
  await page.route("https://www.googleapis.com/**", unreachable);

  await bar
    .getByRole(
      "button",
      phone ? { name: "Done" } : { name: "Save", exact: true },
    )
    .click();

  await expect(page.getByRole("alert")).toContainText("Check your connection.");
  const save = bar.getByRole("button", { name: "Save", exact: true });
  await expect(save).not.toHaveAttribute("aria-disabled");
  if (phone) {
    // Back comes again in place of Done, so the note never holds the user.
    await expect(bar.getByRole("link", { name: "Back to Work" })).toBeVisible();
  }
  expect(drive.writes).toEqual([]);

  await page.unroute("https://www.googleapis.com/**", unreachable);
  await page.context().setOffline(false);
  await save.click();
  await expect(bar.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
});

test("keeps Save in one place through its states, and marks the tab while unsaved", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  const bar = page.getByRole("banner");
  // A status, legible and reachable, rather than a disabled control.
  const saved = bar.getByRole("button", { name: "Saved" });
  await expect(saved).toHaveAttribute("aria-disabled", "true");
  await expect(saved.locator('svg[data-icon="cloud_done"]')).toHaveCount(1);
  await expect(saved).toHaveCSS(
    "color",
    await token(page, "--on-surface-variant"),
  );
  await expect(page).toHaveTitle("DriveMD");
  const before = await saved.boundingBox();
  expect(before?.width).toBeGreaterThanOrEqual(112);

  await tickWhileEditing(page);
  const save = bar.getByRole("button", { name: "Save", exact: true });
  await expect(save).not.toHaveAttribute("aria-disabled");
  await expect(page).toHaveTitle("• DriveMD");
  expect(await save.boundingBox()).toEqual(before);

  await save.click();
  await expect(saved).toBeVisible();
  await expect(page).toHaveTitle("DriveMD");
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
  // Once the note shows, by when its vault check has answered.
  await expect(page.locator(".markdown")).toBeAttached();
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
