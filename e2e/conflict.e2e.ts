import { contrast, looks, token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("weighs the conflict's choices by risk, on the banner's colors", async ({
  page,
  drive,
}, info) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  // Once the note shows, someone else saves it.
  await expect(
    page.locator(".markdown").getByRole("checkbox").first(),
  ).toBeVisible();
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = `${String(plan.content)}\nTheir line.\n`;
  plan.revision = 2;
  // Ticked while viewing, a task saves at once, which finds their change.
  await page.locator(".markdown").getByRole("checkbox").first().check();

  // A banner, its icon beside its title, the differences under it.
  const conflict = page.getByRole("region", {
    name: "Someone changed this file in Google Drive",
  });
  const banner = conflict.locator(".banner");
  await expect(banner.locator('[data-icon="sync_problem"]')).toBeVisible();
  await expect(banner.locator(".differences")).toHaveCount(0);
  await expect(conflict.locator(".differences .cm-content")).toBeVisible();
  const background = await token(page, "--attention-container");
  const label = await token(page, "--on-attention-container");
  expect(
    await banner.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.borderTopLeftRadius, style.padding];
    }),
  ).toEqual([background, "12px", "16px"]);
  // Filled for the copy, which loses nothing.
  const copy = banner.getByRole("button", { name: "Save mine as a copy" });
  expect(await looks(copy)).toMatchObject({
    background: label,
    color: background,
  });
  // Outlined for overwriting, which keeps Drive's version in the history.
  const overwrite = banner.getByRole("button", { name: "Overwrite with mine" });
  expect(await looks(overwrite)).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    color: label,
    border: label,
  });
  // Danger text for dropping the user's changes, which asks again.
  const keep = banner.getByRole("button", { name: "Keep the Drive version" });
  const dropping = await looks(keep);
  expect(dropping).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    color: await token(page, "--error"),
  });
  expect(dropping.border).toBe("rgba(0, 0, 0, 0)");
  expect(contrast(dropping.color, background)).toBeGreaterThanOrEqual(4.5);
  // In a row on a wide screen, one under another across a phone's.
  const [first, second] = await Promise.all(
    [copy, overwrite].map((button) => button.boundingBox()),
  );
  if (!first || !second) throw new Error("Not shown");
  if (info.project.metadata.layout === "phone") {
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.width).toBe(first.width);
  } else {
    expect(second.y).toBe(first.y);
  }
});
