import type { Locator } from "@playwright/test";
import { token } from "./color.ts";
import { expect, noteAction, signIn, test } from "./fake-google.ts";

test("marks what opens a list with an icon, the same everywhere", async ({
  page,
}, info) => {
  await signIn(page);
  const chevron = (link: Locator) =>
    link.locator('svg[data-icon="chevron_right"]');
  // Home's roots where a phone shows them, a folder's folders but not its
  // notes, and the steps of the breadcrumbs.
  if (info.project.metadata.layout === "phone") {
    await expect(
      chevron(page.getByRole("link", { name: "My Drive" })),
    ).toHaveCount(1);
  }
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
  // A table's rows, on a wider screen, need none.
  const phone = info.project.metadata.layout === "phone";
  await expect(archive).toBeVisible({ visible: phone });
  const size = 24;
  if (phone) expect((await archive.boundingBox())?.width).toBe(size);

  await main.getByRole("link", { name: "plan.md" }).click();
  if (info.project.metadata.layout === "wide") {
    // The folder pane leads back to the note's folder.
    await expect(
      chevron(page.getByRole("link", { name: "Work", exact: true })),
    ).toHaveCount(1);
  }
  // The move picker's folders and steps, at the same size.
  await noteAction(page, "Move");
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

test("shows what each row is by its icon", async ({ page }, info) => {
  await signIn(page);
  const phone = info.project.metadata.layout === "phone";
  const wide = info.project.metadata.layout === "wide";
  const icon = (row: Locator) => row.locator("svg").first();
  const main = page.getByRole("main");
  await expect(
    icon(main.getByRole("link", { name: "plan.md" })),
  ).toHaveAttribute("data-icon", "description");
  if (phone) {
    // A phone's Home lists the vaults and the roots, each by its own icon.
    await expect(
      icon(main.getByRole("link", { name: "Journal" })),
    ).toHaveAttribute("data-icon", "book");
    await expect(
      icon(main.getByRole("link", { name: "My Drive" })),
    ).toHaveAttribute("data-icon", "cloud");
    expect(
      (await main.getByRole("link", { name: "My Drive" }).boundingBox())
        ?.height,
    ).toBe(56);
  }

  await page.getByRole("link", { name: "My Drive" }).first().click();
  await expect(
    icon(main.getByRole("link", { name: "Work", exact: true })),
  ).toHaveAttribute("data-icon", "folder");
  await expect(
    icon(main.getByRole("link", { name: /Plan shortcut\.md/ })),
  ).toHaveAttribute("data-icon", "shortcut");
  await expect(icon(main.getByRole("link", { name: /^Gone/ }))).toHaveAttribute(
    "data-icon",
    "link_off",
  );

  if (wide) {
    // The folder pane beside a note fills the note's icon.
    await main.getByRole("link", { name: "Work", exact: true }).click();
    await main.getByRole("link", { name: "plan.md" }).click();
    const pane = page.locator(".pane");
    await expect(
      icon(pane.getByRole("link", { name: "plan.md" })),
    ).toHaveAttribute("data-icon", "description_fill");
    await expect(
      icon(pane.getByRole("link", { name: "Work" })),
    ).toHaveAttribute("data-icon", "folder_open");
    await expect(icon(pane.getByRole("link", { name: "plan.md" }))).toHaveCSS(
      "color",
      await token(page, "--on-secondary-container"),
    );
  }
  if (info.project.metadata.layout === "tablet") {
    // A tablet's folder drawer marks the open note as the pane does.
    await main.getByRole("link", { name: "Work", exact: true }).click();
    await main.getByRole("link", { name: "plan.md" }).click();
    await page.getByRole("button", { name: "Folder" }).click();
    const drawer = page.getByRole("dialog", { name: "Work" });
    await expect(drawer.getByRole("link", { name: "plan.md" })).toHaveCSS(
      "background-color",
      await token(page, "--secondary-container"),
    );
  }
});
