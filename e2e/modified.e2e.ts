import { expect, signIn, test } from "./fake-google.ts";

test("says when and by whom each item last changed", async ({ page }, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Work", exact: true }).click();

  const plan = main.getByRole("link", { name: "plan.md" });
  // Named by its name alone, the change described.
  await expect(plan).toHaveAccessibleName("plan.md");
  await expect(plan).toHaveAccessibleDescription(
    "Sep 1, 2026, by Ada Lovelace",
  );
  await expect(
    main.getByRole("link", { name: "notes.md" }),
  ).toHaveAccessibleDescription("Sep 1, 2026, by you");

  const name = await plan.locator(".name").boundingBox();
  const when = await plan.locator(".modified").boundingBox();
  if (!name || !when) throw new Error("Not shown");
  const head = main.locator(".entries-head");
  if (info.project.metadata.layout === "phone") {
    // On a line of its own under the name.
    expect(when.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(when.x).toBeCloseTo(name.x, 0);
    await expect(head).toBeHidden();
  } else {
    // In a column of its own, under its heading.
    expect(when.x).toBeGreaterThan(name.x + name.width);
    await expect(head).toHaveText(["NameModified"]);
    const heading = await head.getByText("Modified").boundingBox();
    expect(heading?.x).toBeCloseTo(when.x, 0);
  }

  if (info.project.metadata.layout === "wide") {
    // The folder pane beside a note keeps to the names.
    await plan.click();
    await expect(
      page
        .locator(".pane")
        .getByRole("link", { name: "plan.md" })
        .locator(".modified"),
    ).toBeHidden();
  }
});
