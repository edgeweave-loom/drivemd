import { expect, signIn, test } from "./fake-google.ts";

test("gives the folder each note sits in, in Recent and search results", async ({
  page,
}, info) => {
  await signIn(page);
  const recent = page.getByRole("region", { name: "Recent" });
  const plan = recent.getByRole("link", { name: "plan.md" });
  await expect(plan).toHaveAccessibleDescription(
    "Work Sep 1, 2026, by Ada Lovelace",
  );
  const where = plan.locator(".location");
  await expect(where).toHaveText("Work");
  if (info.project.metadata.layout === "phone") {
    // Before the time of change, on the line under the name.
    await expect(plan.locator(".details")).toHaveText(
      "Work · Sep 1, 2026, by Ada Lovelace",
    );
  } else {
    await expect(recent.locator(".entries-head")).toHaveText([
      "NameLocationModified",
    ]);
    const name = await plan.locator(".name").boundingBox();
    const box = await where.boundingBox();
    const when = await plan.locator(".modified").boundingBox();
    if (!name || !box || !when) throw new Error("Not shown");
    expect(box.x).toBeGreaterThan(name.x + name.width);
    expect(when.x).toBeGreaterThan(box.x + box.width);
  }

  // A search's results too.
  if (info.project.metadata.layout === "phone") {
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }
  const search = page.getByRole("searchbox", {
    name: "Search Markdown files by name",
  });
  await search.fill("pla");
  await search.press("Enter");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "plan.md" })
      .locator(".location"),
  ).toHaveText("Work");
});
