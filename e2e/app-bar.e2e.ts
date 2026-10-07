import { token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("names the app beside its mark, and leads Home from any page", async ({
  page,
}, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  const bar = page.getByRole("banner");
  const phone = info.project.metadata.layout === "phone";
  // On a phone, the search box still takes a row of its own below.
  if (!phone) expect((await bar.boundingBox())?.height).toBe(64);
  const mark = bar.locator('img[src="/icon.svg"]');
  await expect(mark).toHaveAttribute("alt", "");
  expect((await mark.boundingBox())?.width).toBe(phone ? 32 : 40);
  await bar.getByRole("link", { name: "DriveMD" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

test("searches from a pill, which rises while it has the focus", async ({
  page,
}) => {
  await signIn(page);
  const field = page.getByRole("searchbox", {
    name: "Search Markdown files by name",
  });
  const search = page.getByRole("search");
  await expect(search.locator("svg")).toHaveCount(1);
  expect((await field.boundingBox())?.height).toBe(48);
  await expect(field).toHaveCSS(
    "background-color",
    await token(page, "--surface-container-high"),
  );
  await field.focus();
  await expect(field).toHaveCSS(
    "background-color",
    await token(page, "--sheet"),
  );
  await expect(field).not.toHaveCSS("box-shadow", "none");
  // And shows the keyboard's focus as every control does.
  await expect(field).toHaveCSS("outline-style", "solid");
});
