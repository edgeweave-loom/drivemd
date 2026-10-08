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
    const name = await bar.getByRole("heading", { level: 1 }).boundingBox();
    expect(name?.width).toBeGreaterThan(100);
  } else {
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    await expect(changed).toBeVisible();
    await expect(account).toBeVisible();
    await expect(unsaved).toBeVisible();
  }
});
