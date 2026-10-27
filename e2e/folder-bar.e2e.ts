import { token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("names the folder in a phone's app bar, with a way up to the one above", async ({
  page,
}, info) => {
  await signIn(page);
  const bar = page.getByRole("banner");
  await page.getByRole("link", { name: "My Drive" }).first().click();
  if (info.project.metadata.layout !== "phone") {
    // A wider screen keeps DriveMD's mark, beside the drawer or the rail.
    await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
    return;
  }
  await expect(bar.getByRole("heading", { name: "My Drive" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "DriveMD" })).toBeHidden();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  await expect(bar.getByRole("heading", { name: "Work" })).toBeVisible();
  // The breadcrumbs stay under the bar.
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("listitem"),
  ).toHaveText(["Home", "My Drive", "Work"]);

  await bar.getByRole("link", { name: "Back to My Drive" }).click();
  await expect(bar.getByRole("heading", { name: "My Drive" })).toBeVisible();
  await bar.getByRole("link", { name: "Back to Home" }).click();
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "DriveMD" })).toBeVisible();
});

test("offers New note as a floating button on a phone", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  const create = page.getByRole("button", { name: "New note" });
  await expect(create.locator('svg[data-icon="add"]')).toHaveCount(1);
  if (info.project.metadata.layout !== "phone") {
    await expect(create).toHaveCSS(
      "background-color",
      await token(page, "--secondary-container"),
    );
    return;
  }
  await expect(create).toHaveCSS("position", "fixed");
  await expect(create).toHaveCSS(
    "background-color",
    await token(page, "--primary-container"),
  );
  const box = await create.boundingBox();
  const screen = page.viewportSize();
  if (!box || !screen) throw new Error("Not shown");
  expect(box.height).toBe(56);
  expect(screen.width - (box.x + box.width)).toBe(16);
  expect(screen.height - (box.y + box.height)).toBeGreaterThanOrEqual(16);
});

test("ends the breadcrumbs at the folder, its steps in grey", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  // Home only where no drawer or rail leads there.
  await expect(crumbs.getByRole("link")).toHaveText(
    info.project.metadata.layout === "phone"
      ? ["Home", "My Drive"]
      : ["My Drive"],
  );
  const step = crumbs.getByRole("link", { name: "My Drive" });
  await expect(step).toHaveCSS(
    "color",
    await token(page, "--on-surface-variant"),
  );
  await expect(step).toHaveCSS("text-decoration-line", "none");
  const here = crumbs.getByText("Work", { exact: true });
  await expect(here).toHaveAttribute("aria-current", "page");
  await expect(here).toHaveCSS("color", await token(page, "--on-surface"));
  await expect(here).toHaveCSS("font-weight", "500");
  // Beside the drawer or the rail, the first step's text lines up with the
  // heading under it, its pill reaching past it.
  if (info.project.metadata.layout === "phone") return;
  const first = await crumbs.getByRole("listitem").first().boundingBox();
  const heading = await page
    .getByRole("main")
    .getByRole("heading", { level: 2, name: "Work" })
    .boundingBox();
  expect(first?.x).toBe((heading?.x ?? 0) - 8);
});

test("rings a breadcrumb step's 32 px pill, within its 44 px target", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Work", exact: true })
    .click();
  const step = page
    .getByRole("navigation", { name: "Breadcrumbs" })
    .getByRole("link", { name: "My Drive" });
  // The focus ring follows the link's box, which is the pill.
  const pill = await step.boundingBox();
  expect(pill?.height).toBe(32);
  const reached = await step.evaluate((link) => {
    const box = link.getBoundingClientRect();
    const x = box.left + box.width / 2;
    return [box.top - 5, box.bottom + 5].map(
      (y) => document.elementFromPoint(x, y) === link,
    );
  });
  expect(reached).toEqual([true, true]);
});

test("shows breadcrumbs on folder pages only", async ({ page }) => {
  await signIn(page);
  await page.goto("/shortcuts");
  await expect(
    page.getByRole("main").getByRole("link", { name: /Plan shortcut/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }),
  ).toHaveCount(0);
});
