import { expect, goHome, signIn, test } from "./fake-google.ts";

test("shows the 10 notes opened last, then all of them, through Back", async ({
  page,
  drive,
}) => {
  await signIn(page);
  // Viewed before plan.md, which is viewed again below.
  const older = Array.from({ length: 11 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `older-${number}`,
      name: `older-${number}.md`,
      mimeType: "text/markdown",
      parents: ["work"],
      viewedByMeTime: `2026-09-${String(19 - index).padStart(2, "0")}T10:00:00.000Z`,
    };
  });
  for (const file of older) drive.files.set(file.id, file);
  const names = ["plan.md", ...older.map(({ name }) => name)];
  const recent = page.getByRole("region", { name: "Recent" });
  const links = recent.getByRole("link");

  // Opening a note has Home ask Drive for Recent again.
  await recent.getByRole("link", { name: "plan.md" }).click();
  await expect(
    page.getByRole("banner").getByRole("heading", { name: "plan.md" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await goHome(page);
  await expect(links.locator(".name")).toHaveText(names.slice(0, 10));
  await expect(links.locator(".location")).toHaveText(Array(10).fill("Work"));

  const showAll = recent.getByRole("button", { name: "Show all" });
  await showAll.focus();
  await page.keyboard.press("Enter");
  await expect(links.locator(".name")).toHaveText(names);
  await expect(recent.getByRole("link", { name: "older-10.md" })).toBeFocused();
  await expect(showAll).toHaveCount(0);
  await expect(links.locator(".location")).toHaveText(Array(12).fill("Work"));

  await recent.getByRole("link", { name: "older-11.md" }).click();
  await expect(
    page.getByRole("banner").getByRole("heading", { name: "older-11.md" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.goBack();
  // Still unfolded, whether or not Drive has the note opened last first yet.
  await expect(links).toHaveCount(12);
  await expect(showAll).toHaveCount(0);
  await expect(links.locator(".location")).toHaveText(Array(12).fill("Work"));
});
