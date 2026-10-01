import type { Page } from "@playwright/test";
import { EMAIL, expect, signIn, test } from "./fake-google.ts";

function crumbs(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumbs" });
}

/** The page's own list, apart from the breadcrumbs and the folder pane. */
function entries(page: Page) {
  return page.locator(".main .entries, main > .entries").last();
}

async function openWork(page: Page) {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Work" }),
  ).toBeVisible();
}

test("signs in, browses to a file and back, and keeps the path on reload", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText(EMAIL)).toBeVisible();

  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page.locator("main").getByRole("link")).toContainText([
    "Archive",
    "notes.md",
    "plan.md",
  ]);
  await expect(page.getByText("photo.png")).toHaveCount(0);

  await page.getByRole("link", { name: "plan.md" }).first().click();
  await expect(
    page.getByRole("heading", { level: 2, name: "plan.md" }),
  ).toBeVisible();
  await expect(page.getByText(/^Last modified by Ada Lovelace/)).toBeVisible();
  await expect(page.getByText(/^# The plan/)).toBeVisible();
  await expect(crumbs(page).getByRole("link")).toHaveText([
    "Home",
    "My Drive",
    "Work",
  ]);

  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 2, name: "Work" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Archive" })).toBeVisible();
  await page.reload();
  await expect(crumbs(page).getByRole("link")).toHaveText(["Home", "My Drive"]);
});

test("rebuilds the breadcrumbs of a page opened by its address", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await expect(crumbs(page).getByRole("link")).toHaveText([
    "Home",
    "My Drive",
    "Work",
  ]);
});

test("follows a shortcut, and greys out one whose target is gone", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();

  await expect(page.getByRole("link", { name: "Gone" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByText("Deleted, or not shared with you")).toBeVisible();
  await page.getByRole("link", { name: /Plan shortcut\.md/ }).click();
  await expect(page).toHaveURL(/\/edit\?id=plan$/);
});

test("shows Recent, the vaults, and the other roots", async ({ page }) => {
  await signIn(page);
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent.getByRole("link", { name: "plan.md" })).toBeVisible();
  const vaults = page.getByRole("region", { name: "Vaults" });
  await expect(vaults.getByRole("link", { name: "Journal" })).toBeVisible();

  await page.getByRole("link", { name: "Shared drives" }).click();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("link", { name: "specs.md" })).toBeVisible();

  await page.goto("/shared-with-me");
  await page.getByRole("link", { name: "Shared notes" }).click();
  await expect(page.getByRole("link", { name: "shared.md" })).toBeVisible();
});

test("searches Markdown files by name", async ({ page }) => {
  await signIn(page);
  const search = page.getByRole("searchbox", {
    name: "Search Markdown files by name",
  });
  await search.fill("pla");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { level: 2, name: "Search: pla" }),
  ).toBeVisible();
  await expect(entries(page).getByRole("link")).toHaveText(["plan.md"]);
  await expect(search).toBeFocused();
});

test("creates, renames, moves and trashes a file", async ({ page, drive }) => {
  await openWork(page);

  await page.getByRole("button", { name: "New" }).click();
  const create = page.getByRole("dialog", { name: "New Markdown file" });
  await create.getByRole("textbox", { name: "Name" }).fill("ideas");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "ideas.md" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await rename.getByRole("textbox", { name: "Name" }).fill("roadmap.md");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "roadmap.md" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Move", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move roadmap.md" });
  await move.getByRole("button", { name: "Archive" }).click();
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(move).toHaveCount(0);
  await expect(crumbs(page).getByRole("link")).toHaveText([
    "Home",
    "My Drive",
    "Work",
    "Archive",
  ]);

  await page.getByRole("button", { name: "Move to trash" }).click();
  const trash = page.getByRole("dialog", { name: "Move to trash?" });
  await trash.getByRole("button", { name: "Move to trash" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Archive" }),
  ).toBeVisible();
  expect(drive.writes).toEqual([
    "create ideas.md",
    "rename created-1 roadmap.md",
    "move created-1 archive",
    "trash created-1",
  ]);
});

test("asks to Continue over an open dialog when Drive refuses the token", async ({
  page,
  drive,
}) => {
  await openWork(page);
  await page.getByRole("button", { name: "New" }).click();
  const create = page.getByRole("dialog", { name: "New Markdown file" });

  drive.expireToken();
  await create.getByRole("button", { name: "Create" }).click();
  const prompt = page.getByRole("dialog", { name: "Welcome back" });
  await prompt.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Untitled.md" }),
  ).toBeVisible();
});

test("lists a file's folder as the screen allows", async ({ page }, info) => {
  await openWork(page);
  await page.getByRole("link", { name: "plan.md" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "plan.md" }),
  ).toBeVisible();
  const pane = page.getByRole("complementary", { name: "Work" });
  const folder = page.getByRole("button", { name: "Folder" });

  switch (info.project.metadata.layout) {
    case "wide":
      await expect(pane.getByRole("link", { name: "notes.md" })).toBeVisible();
      await expect(folder).toHaveCount(0);
      break;
    case "tablet": {
      await expect(pane).toHaveCount(0);
      await folder.click();
      const drawer = page.getByRole("dialog", { name: "Work" });
      await expect(
        drawer.getByRole("link", { name: "notes.md" }),
      ).toBeVisible();
      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toHaveCount(0);
      break;
    }
    default:
      await expect(pane).toHaveCount(0);
      await expect(folder).toHaveCount(0);
  }
});

test("keeps the page within the screen, with taps of 44 px at least", async ({
  page,
}) => {
  await openWork(page);
  await expect(entries(page).getByRole("link")).toHaveCount(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const target of await entries(page).getByRole("link").all()) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
