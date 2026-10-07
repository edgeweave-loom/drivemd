import { token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

test("leads into Drive from a drawer beside the page, on a wide screen", async ({
  page,
}, info) => {
  await signIn(page);
  const drawer = page.getByRole("navigation", { name: "Drive" });
  // A tablet shows the rail, which its own test checks, and a phone neither.
  if (info.project.metadata.layout === "tablet") {
    await expect(drawer).toHaveClass(/\brail\b/);
    return;
  }
  if (info.project.metadata.layout === "phone") {
    await expect(drawer).toHaveCount(0);
    return;
  }
  await expect(drawer.getByRole("link")).toHaveText([
    "Home",
    "My Drive",
    "Shortcuts",
    "Shared drives",
    "Shared with me",
    "Journal",
  ]);
  await expect(drawer.getByRole("heading", { name: "Vaults" })).toBeVisible();
  const home = drawer.getByRole("link", { name: "Home" });
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(home).toHaveCSS(
    "background-color",
    await token(page, "--secondary-container"),
  );
  // Home leaves the roots and the vaults to the drawer.
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse" })).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Vaults" }),
  ).toHaveCount(0);
  // The page sits on a panel, over the app's background.
  await expect(page.locator(":root")).toHaveCSS(
    "background-color",
    await token(page, "--app-background"),
  );
  await expect(page.getByRole("main")).toHaveCSS(
    "background-color",
    await token(page, "--sheet"),
  );

  await drawer.getByRole("link", { name: "My Drive" }).click();
  const myDrive = drawer.getByRole("link", { name: "My Drive" });
  await expect(myDrive).toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current");
  // A folder in My Drive is still in My Drive.
  await page.getByRole("main").getByRole("link", { name: "Work" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Work" }),
  ).toBeVisible();
  await expect(myDrive).toHaveAttribute("aria-current", "true");

  // A note shows its folder beside it rather than the drawer.
  await page.getByRole("main").getByRole("link", { name: "plan.md" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "The plan" }),
  ).toBeVisible();
  await expect(drawer).toHaveCount(0);
});
