import { expect, signIn, test } from "./fake-google.ts";

test("renders a note of a vault as Obsidian does", async ({ page }) => {
  await signIn(page);
  await page.goto("/edit?id=today");

  const note = page.locator(".markdown");
  // A single line break shows as one, as the vault's settings leave it.
  await expect(note.locator("p")).toHaveText("Woke up early.\nMade tea.");
  await expect(note.locator("p br")).toHaveCount(1);
});
