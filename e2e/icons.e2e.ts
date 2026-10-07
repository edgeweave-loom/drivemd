import type { Locator } from "@playwright/test";
import { expect, signIn, test } from "./fake-google.ts";

test("marks what opens a list with an icon, the same everywhere", async ({
  page,
}, info) => {
  await signIn(page);
  const chevron = (link: Locator) => link.locator("svg");
  // Home's roots, a folder's folders but not its notes, and the steps of
  // the breadcrumbs.
  await expect(
    chevron(page.getByRole("link", { name: "My Drive" })),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  const main = page.getByRole("main");
  const archive = chevron(main.getByRole("link", { name: "Archive" }));
  await expect(archive).toHaveCount(1);
  await expect(
    chevron(main.getByRole("link", { name: "plan.md" })),
  ).toHaveCount(0);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(crumbs.locator("svg")).toHaveCount(1);
  await expect(crumbs).not.toContainText("›");
  const size = (await archive.boundingBox())?.width;
  expect(size).toBe(24);

  await main.getByRole("link", { name: "plan.md" }).click();
  if (info.project.metadata.layout === "wide") {
    // The folder pane leads back to the note's folder.
    await expect(
      chevron(page.getByRole("link", { name: "Work", exact: true })),
    ).toHaveCount(1);
  }
  // The move picker's folders and steps, at the same size.
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move plan.md" });
  const folder = move.getByRole("button", { name: "Archive" });
  expect((await chevron(folder).boundingBox())?.width).toBe(size);
  await folder.click();
  const above = move.getByRole("navigation", { name: "Folders above" });
  await expect(above.getByRole("button")).toHaveText([
    "All drives",
    "My Drive",
    "Work",
  ]);
  await expect(above.locator("svg")).toHaveCount(2);
});
