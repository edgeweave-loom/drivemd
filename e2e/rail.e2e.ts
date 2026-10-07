import { token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("leads into Drive from a navigation rail on a tablet", async ({
  page,
}, info) => {
  await signIn(page);
  const rail = page.getByRole("navigation", { name: "Drive" });
  if (info.project.metadata.layout !== "tablet") {
    if (info.project.metadata.layout === "phone") {
      await expect(rail).toHaveCount(0);
    }
    return;
  }
  expect((await rail.boundingBox())?.width).toBe(80);
  await expect(rail.getByRole("link")).toHaveText([
    "Home",
    "My Drive",
    "Shortcuts",
    "Shared drives",
    "Shared with me",
  ]);
  const home = rail.getByRole("link", { name: "Home" });
  await expect(home).toHaveAttribute("aria-current", "page");
  // Its indicator, a pill over the label, holds the icon.
  const indicator = home.locator(".indicator");
  await expect(indicator).toHaveCSS(
    "background-color",
    await token(page, "--secondary-container"),
  );
  expect(await indicator.boundingBox()).toMatchObject({
    width: 56,
    height: 32,
  });
  // Home leaves the roots and the vaults to the rail.
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse" })).toHaveCount(0);

  // The vaults wait behind one item, in a menu.
  await rail.getByRole("button", { name: "Vaults" }).click();
  const menu = page.getByRole("dialog", { name: "Vaults" });
  await menu.getByRole("link", { name: "Journal" }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/\/folder\/journal$/);
  await expect(rail.getByRole("button", { name: "Vaults" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
