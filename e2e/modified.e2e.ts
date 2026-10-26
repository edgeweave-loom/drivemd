import {
  draftsKept,
  expect,
  goHome,
  signIn,
  test,
  tickWhileEditing,
} from "./fake-google.ts";

test("says when and by whom each item last changed", async ({ page }, info) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).first().click();
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Work", exact: true }).click();

  const plan = main.getByRole("link", { name: "plan.md" });
  // Named by its name alone, the change described.
  await expect(plan).toHaveAccessibleName("plan.md");
  await expect(plan).toHaveAccessibleDescription(
    "Sep 1, 2026, by Ada Lovelace",
  );
  await expect(
    main.getByRole("link", { name: "notes.md" }),
  ).toHaveAccessibleDescription("Sep 1, 2026, by you");

  const name = await plan.locator(".name").boundingBox();
  const when = await plan.locator(".modified").boundingBox();
  if (!name || !when) throw new Error("Not shown");
  const head = main.locator(".entries-head");
  if (info.project.metadata.layout === "phone") {
    // On a line of its own under the name.
    expect(when.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(when.x).toBeCloseTo(name.x, 0);
    await expect(head).toBeHidden();
  } else {
    // In a column of its own, under its heading.
    expect(when.x).toBeGreaterThan(name.x + name.width);
    await expect(head).toHaveText(["NameModified"]);
    const heading = await head.getByText("Modified").boundingBox();
    expect(heading?.x).toBeCloseTo(when.x, 0);
  }

  if (info.project.metadata.layout === "wide") {
    // The folder pane beside a note keeps to the names.
    await plan.click();
    await expect(
      page
        .locator(".pane")
        .getByRole("link", { name: "plan.md" })
        .locator(".modified"),
    ).toBeHidden();
  }
});

test("says why a broken shortcut opens nothing, in the folder pane too", async ({
  page,
  drive,
}, info) => {
  test.skip(
    info.project.metadata.layout !== "wide",
    "Only a wide screen shows the folder pane beside a note.",
  );
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  // In My Drive, beside the broken shortcut.
  plan.parents = ["my-root"];
  await signIn(page);
  await page
    .getByRole("navigation", { name: "Drive" })
    .getByRole("link", { name: "My Drive" })
    .click();
  await page.getByRole("main").getByRole("link", { name: "plan.md" }).click();
  const gone = page.locator(".pane").getByRole("link", { name: /^Gone/ });
  await expect(gone).toHaveAccessibleName("Gone Shortcut");
  await expect(gone.getByText("Deleted, or not shared with you")).toBeVisible();
});

test.describe("on a device in another language", () => {
  test.use({ locale: "fr-FR", timezoneId: "UTC" });

  test("writes the dates in English, as the interface", async ({ page }) => {
    // "Oct 26, 2026, 10:58 AM", rather than "26 oct. 2026 à 10:58".
    const when = /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M/;
    await signIn(page);
    await page.goto("/edit?id=plan");
    await expect(
      page.getByText(/^Last modified by Ada Lovelace on /),
    ).toHaveText(/ on Sep 1, 2026, 10:00\sAM$/);
    await tickWhileEditing(page);
    await expect.poll(() => draftsKept(page)).toBe(1);

    page.once("dialog", (dialog) => void dialog.accept());
    await goHome(page);
    const unsaved = page.getByRole("region", { name: "Unsaved changes" });
    await expect(unsaved.locator("time")).toHaveText(when);
    await unsaved.getByRole("link").click();
    await expect(
      page.getByText(/^You have unsaved changes to this note from /),
    ).toHaveText(new RegExp(` from ${when.source}, kept on this device\\.$`));
  });
});
