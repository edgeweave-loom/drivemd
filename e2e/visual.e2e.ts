import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fake-google.ts";

/** Opens plan.md in Visual: from Edit on a phone, or else from the mode menu. */
async function editInVisual(page: Page) {
  await signIn(page);
  await page.goto("/edit?id=plan");
  if (test.info().project.metadata.layout === "phone") {
    // Editing opens in Visual at first.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  } else {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Viewing" })
      .click();
    await page
      .getByRole("menu", { name: "Mode" })
      .getByRole("menuitemradio", { name: "Visual" })
      .click();
  }
  return page.getByRole("textbox", { name: "Note" });
}

test("hides Markdown's symbols in Visual, but on the line being written", async ({
  page,
  drive,
}) => {
  const heading = (await editInVisual(page))
    .locator(".cm-line")
    .filter({ hasText: "The plan" });
  await expect(heading).toHaveText("The plan");

  await heading.click();
  await expect(heading).toHaveText("# The plan");
  await page.keyboard.press("End");
  await page.keyboard.type(" **for tea**");
  await page.keyboard.press("ArrowDown");
  await expect(heading).toHaveText("The plan for tea");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toContain(
    "---\n# The plan **for tea**\n\n| Step |",
  );
});

test("shows a link's text in Visual, which Cmd or Ctrl+click follows", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "Keyboard and mouse shortcuts are for desktops",
  );
  const note = await editInVisual(page);
  await expect(
    note.locator(".cm-line").filter({ hasText: "Next:" }),
  ).toHaveText("Next: the notes, the archive, a photo and nothing.");

  await note.getByText("the notes", { exact: true }).click({
    modifiers: ["Control"],
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "notes.md" }),
  ).toBeVisible();
});

test("opens a link from the keyboard toolbar on a touch screen", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "desktop-chromium",
    "A mouse's keyboard has no toolbar",
  );
  const note = await editInVisual(page);

  // A tap places the cursor in the link, showing its Markdown once the
  // finger lifts.
  const link = note.getByText("the notes", { exact: true });
  await link.tap();
  await expect(
    note.locator(".cm-line").filter({ hasText: "Next:" }),
  ).toContainText("[the notes](notes.md#later)");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(
    toolbar.getByRole("button", { name: "Link", exact: true }),
  ).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Open link" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "notes.md" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/edit\?id=notes#later$/);
});

test("ticks a task from its box in Visual, as one edit to save", async ({
  page,
  drive,
}, info) => {
  const note = await editInVisual(page);
  const boxes = note.locator(".cm-task");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first()).not.toBeChecked();

  if (info.project.name === "desktop-chromium") await boxes.first().click();
  else await boxes.first().tap();
  await expect(boxes.first()).toBeChecked();
  // The cursor stays away: the task still shows as its box.
  await expect(boxes).toHaveCount(2);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toContain(
    "\n- [x] Boil water\n- [x] Find cups\n",
  );
});

test("keeps a tapped line under the finger as another line hides its symbols", async ({
  page,
  drive,
}, info) => {
  test.skip(
    info.project.name === "desktop-chromium",
    "A mouse points where it is, and needs no line kept under it",
  );
  const notes = drive.files.get("notes");
  if (notes) {
    notes.content = [
      ...Array.from({ length: 30 }, (_, line) => `Line ${String(line + 1)}.`),
      "",
      "Some **bold words**, _slanted ones_, ~~struck ones~~, `code` and [a link](https://example.com/a/rather/long/address) to wrap.",
      "",
      "## A heading with closing marks ##",
      "",
      ...Array.from({ length: 30 }, (_, line) => `Line ${String(line + 31)}.`),
    ].join("\n");
  }
  await signIn(page);
  await page.goto("/edit?id=notes");
  if (info.project.metadata.layout === "phone") {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  } else {
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Viewing" })
      .click();
    await page
      .getByRole("menu", { name: "Mode" })
      .getByRole("menuitemradio", { name: "Visual" })
      .click();
  }
  const note = page.getByRole("textbox", { name: "Note" });
  const paragraph = note.locator(".cm-line").filter({ hasText: "Some" });
  const heading = note.locator(".cm-line").filter({ hasText: "A heading" });
  await paragraph.scrollIntoViewIfNeeded();

  // The paragraph shows its symbols, on more lines.
  await paragraph.getByText("bold words").tap();
  await expect(paragraph).toContainText("**bold words**");
  // Once the toolbar has scrolled the cursor clear of it, if it had to,
  // the heading in the middle of the screen, the page scrolled down still.
  await page.waitForTimeout(1500);
  await heading.evaluate((line) => {
    line.scrollIntoView({ block: "center" });
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const before = await heading.boundingBox();
  if (!before) throw new Error("Not shown");

  await page.touchscreen.tap(before.x + 40, before.y + before.height / 2);
  await expect(heading).toContainText("## A heading with closing marks ##");
  await expect(paragraph).not.toContainText("**");
  await expect
    .poll(async () => (await heading.boundingBox())?.y)
    .toBeCloseTo(before.y, 0);
});
