import { expect, signIn, test } from "./fake-google.ts";

test("renders a note of a vault as Obsidian does", async ({ page }) => {
  await signIn(page);
  await page.goto("/edit?id=today");

  const note = page.locator(".markdown");
  // A single line break shows as one, as the vault's settings leave it.
  await expect(note.locator("p").first()).toHaveText(
    "Woke up early.\nMade tea.",
  );
  await expect(note.locator("p br")).toHaveCount(1);
  // A folded callout, in its type's color, opens with a tap on its title.
  const callout = note.locator(".callout");
  await expect(callout).toHaveCSS("border-left-color", "rgb(0, 191, 188)");
  await expect(callout.getByText("Water at 90 °C.")).toBeHidden();
  await callout.getByText("Brew it hot").click();
  await expect(callout.getByText("Water at 90 °C.")).toBeVisible();
  const title = await callout.locator("summary").boundingBox();
  expect(title?.height).toBeGreaterThanOrEqual(44);
});
