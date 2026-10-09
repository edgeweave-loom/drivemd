import type { Page } from "@playwright/test";
import {
  expect,
  noteAction,
  signIn,
  startEditing,
  test,
} from "./fake-google.ts";

/**
 * Opens plan.md as Drive's Open with does: in a new tab, which has no token
 * yet, on a device that remembers the account.
 */
async function openFromDrive(page: Page) {
  await signIn(page);
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  const state = {
    ids: ["plan"],
    resourceKeys: {},
    action: "open",
    userId: "104857600000000000001",
  };
  await page.goto(`/open?state=${encodeURIComponent(JSON.stringify(state))}`);
  // Before sign-in, the screen says what Drive asked for.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Open a note from Google Drive",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Google lets you choose the account, starting with the one Drive used.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await shown(page);
}

/** Waits for the note, and for Drive to answer all it was asked. */
async function shown(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: "The plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "More actions" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("holds the note alone, through a reload, until another address opens", async ({
  page,
}, info) => {
  const phone = info.project.metadata.layout === "phone";
  await openFromDrive(page);

  const bar = page.getByRole("banner");
  const mark = bar.getByRole("img", { name: "DriveMD" });
  // Nothing leads elsewhere in the app: no mark to Home, no Back, no folder.
  await expect(mark).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Folder" })).toHaveCount(0);
  // Editing on a wide screen, the source beside the preview, as Docs opens a
  // document on a computer; reading on a phone.
  await expect(page.getByRole("region", { name: "Markdown" })).toHaveCount(
    phone ? 0 : 1,
  );
  await expect(
    phone
      ? page.getByRole("button", { name: "Edit", exact: true })
      : bar.getByRole("button", { name: "Editing" }),
  ).toBeVisible();
  if (phone) {
    // A phone's Done takes the mark's place while editing.
    await startEditing(page);
    await expect(bar.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(mark).toBeHidden();
    await bar.getByRole("button", { name: "Done" }).click();
    await expect(mark).toBeVisible();
    // The account, which no Home holds here, is in More actions.
    await bar.getByRole("button", { name: "More actions" }).click();
    const menu = page.getByRole("dialog", { name: "More actions" });
    await expect(
      menu.getByRole("link", { name: "About DriveMD" }),
    ).toBeVisible();
    await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  } else {
    await expect(bar.getByRole("button", { name: /^Account, / })).toBeVisible();
  }

  await page.reload();
  await shown(page);
  await expect(mark).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(0);

  // An address typed in the tab ends the mode.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page
    .getByRole("region", { name: "Recent" })
    .getByRole("link", { name: "plan.md" })
    .click();
  await shown(page);
  await expect(
    phone
      ? bar.getByRole("link", { name: "Back to Work" })
      : bar.getByRole("link", { name: "DriveMD" }),
  ).toBeVisible();
});

test("stays on the note it moves to the trash, which then says so", async ({
  page,
}, info) => {
  await openFromDrive(page);

  await noteAction(page, "Move to trash");
  await page
    .getByRole("dialog", { name: "Move to trash?" })
    .getByRole("button", { name: "Move to trash" })
    .click();

  await expect(
    page.getByText(
      "This file is in the trash. Restore it from Google Drive to open it.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/edit\?id=plan$/);
  // Nothing more for the note: on a phone, More actions holds the account.
  const more = page
    .getByRole("banner")
    .getByRole("button", { name: "More actions" });
  if (info.project.metadata.layout !== "phone") {
    await expect(more).toHaveCount(0);
    return;
  }
  await more.click();
  await expect(
    page
      .getByRole("dialog", { name: "More actions" })
      .getByRole("button", { name: "Move to trash" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "About DriveMD" })).toBeVisible();
});
