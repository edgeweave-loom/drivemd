import { expect, signIn, test } from "./fake-google.ts";

test("hides Markdown's symbols in Visual, but on the line being written", async ({
  page,
  drive,
}, info) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  if (info.project.metadata.layout === "phone") {
    // Editing opens in Visual at first.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  } else {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Viewing" })
      .click();
    await page
      .getByRole("menu", { name: "Mode" })
      .getByRole("menuitemradio", { name: "Visual" })
      .click();
  }
  const heading = page
    .getByRole("textbox", { name: "Note" })
    .locator(".cm-line")
    .filter({ hasText: "The plan" });
  await expect(heading).toHaveText("The plan");

  await heading.click();
  await expect(heading).toHaveText("# The plan");
  await page.keyboard.press("End");
  await page.keyboard.type(" **for tea**");
  await page.keyboard.press("ArrowDown");
  await expect(heading).toHaveText("The plan for tea");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toContain(
    "---\n# The plan **for tea**\n\n| Step |",
  );
});
