import type { Page } from "@playwright/test";
import {
  expect,
  signIn,
  startEditing,
  test,
  tickWhileEditing,
  vault,
} from "./fake-google.ts";

const TITLE = "A new version of DriveMD is ready";

/** Hosting, once a new version replaced the one the page runs. */
async function deploy(page: Page): Promise<void> {
  await page.route("**/version.json", (route) =>
    route.fulfill({ json: { version: "99.0.0" } }),
  );
}

/**
 * The page shows again, as when the user comes back to the tab or to the
 * Home Screen app, once Hosting has said which version it serves.
 */
async function comeBack(page: Page): Promise<void> {
  const answered = page.waitForResponse("**/version.json");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await answered;
}

function offer(page: Page) {
  return page.getByRole("region", { name: TITLE });
}

async function openNote(page: Page): Promise<void> {
  await page.goto("/edit?id=plan");
  await expect(
    page.locator(".markdown").getByRole("heading", { name: "The plan" }),
  ).toBeVisible();
}

test("serves the version the build names, which offers nothing new", async ({
  page,
  request,
}) => {
  await signIn(page);
  const response = await request.get("/version.json");
  // Hosting serves it as the app's page, which the browser keeps no copy of.
  expect(response.headers()["cache-control"]).toBe("no-cache");
  const { version } = (await response.json()) as { version: string };

  await comeBack(page);

  await page.getByRole("button", { name: /^Account, / }).click();
  await expect(
    page.getByRole("dialog", { name: "Account" }).getByText(/^DriveMD /),
  ).toHaveText(`DriveMD ${version}`);
  await expect(offer(page)).toHaveCount(0);
});

test("offers a new version once the page shows again, then loads it", async ({
  page,
}) => {
  await signIn(page);
  await deploy(page);

  await comeBack(page);
  await expect(offer(page)).toBeVisible();
  await offer(page).getByRole("button", { name: "Later" }).click();
  await expect(offer(page)).toHaveCount(0);
  // The account's menu still offers it.
  await page.getByRole("button", { name: /^Account, / }).click();
  const loaded = page.waitForEvent("load");
  await page
    .getByRole("dialog", { name: "Account" })
    .getByRole("button", { name: "Reload to update" })
    .click();
  await loaded;

  // Home loads again, in the same session.
  await expect(
    page.getByRole("region", { name: "Recent" }).getByRole("link"),
  ).toHaveCount(1);
  await expect(vault(page)).toBeVisible();
});

test("waits for a note's changes to be saved before offering a new version", async ({
  page,
}) => {
  await signIn(page);
  await openNote(page);
  await deploy(page);

  await tickWhileEditing(page);
  await comeBack(page);
  await expect(offer(page)).toHaveCount(0);
  await page
    .getByRole("banner")
    .getByRole(
      "button",
      test.info().project.metadata.layout === "phone"
        ? { name: "Done" }
        : { name: "Save", exact: true },
    )
    .click();

  await expect(offer(page)).toBeVisible();
  // It heads the note, lined up with its sheets.
  if (test.info().project.metadata.layout !== "phone") {
    const sheet = await page.locator(".sheet").first().boundingBox();
    expect((await offer(page).boundingBox())?.x).toBe(sheet?.x);
  }
});

test("offers the new version when the editor's code is no longer served", async ({
  page,
}) => {
  await signIn(page);
  await openNote(page);
  await deploy(page);
  await page.route("**/assets/Editor-*.js", (route) =>
    route.fulfill({ status: 404 }),
  );

  await startEditing(page);

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "A new version of DriveMD is ready." }),
  ).toHaveText(
    "A new version of DriveMD is ready. Reload to open its editor. Reload",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(offer(page)).toBeVisible();
});
