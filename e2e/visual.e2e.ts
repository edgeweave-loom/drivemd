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

test("draws a thematic break as a rule in Visual, on its line's height", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = "# The plan\n\nTea.\n\n- - -\n\n> ***\n\nCups.\n";
  const lines = (await editInVisual(page)).locator(".cm-line");
  const text = lines.filter({ hasText: "Tea." });
  const rule = lines.nth(4);
  const quoted = lines.nth(6);
  await expect(rule.getByRole("separator")).toBeVisible();
  await expect(quoted.getByRole("separator")).toBeVisible();
  // Its marks unseen, under the rule drawn through them.
  await expect(rule.getByRole("separator")).toHaveCSS(
    "color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(rule.getByRole("separator")).toHaveCSS(
    "background-image",
    /linear-gradient/,
  );

  const height = async (line: typeof rule) =>
    (await line.boundingBox())?.height;
  const lineHeight = await height(text);
  expect(await height(rule)).toBeCloseTo(lineHeight ?? 0, 0);
  expect(await height(quoted)).toBeCloseTo(lineHeight ?? 0, 0);
  // Across the line, from its text's start, or from the quote's `>`.
  const [ruleBox, textBox, quotedBox] = await Promise.all([
    rule.getByRole("separator").boundingBox(),
    text.boundingBox(),
    quoted.getByRole("separator").boundingBox(),
  ]);
  if (!ruleBox || !textBox || !quotedBox) throw new Error("Not shown");
  expect(ruleBox.width).toBeGreaterThan(textBox.width / 2);
  expect(quotedBox.x).toBeGreaterThan(ruleBox.x);

  // Written as it is where the cursor is, on the same height.
  if (info.project.name === "desktop-chromium") await rule.click();
  else await rule.tap();
  await expect(rule.getByRole("separator")).toHaveCount(0);
  await expect(rule).toHaveText("- - -");
  expect(await height(rule)).toBeCloseTo(lineHeight ?? 0, 0);
  await expect(quoted.getByRole("separator")).toBeVisible();

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);
});

test("draws a quote in Visual, a bar per level, its marks shown where the cursor is", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = "# The plan\n\nTea.\n\n> Some tea\n> > and cups\n\nCups.\n";
  const lines = (await editInVisual(page)).locator(".cm-line");
  const text = lines.filter({ hasText: "Tea." });
  const quote = lines.nth(4);
  const nested = lines.nth(5);
  await expect(quote).toHaveText("Some tea");
  await expect(nested).toHaveText("and cups");

  // A 0.25em bar per level, then 1em before the text, quieter.
  const em = Number.parseFloat(
    await quote.evaluate((element) => getComputedStyle(element).fontSize),
  );
  const level = 1.25 * em;
  await expect(quote).toHaveCSS("background-image", /linear-gradient/);
  await expect(quote).toHaveCSS("background-size", `${String(level)}px 100%`);
  await expect(nested).toHaveCSS(
    "background-size",
    `${String(2 * level)}px 100%`,
  );
  const inset = async (line: typeof quote) =>
    Number.parseFloat(
      await line.evaluate((element) => getComputedStyle(element).paddingLeft),
    );
  const textInset = await inset(text);
  expect(await inset(quote)).toBeCloseTo(textInset + level, 0);
  expect(await inset(nested)).toBeCloseTo(textInset + 2 * level, 0);
  const color = (line: typeof quote) =>
    line.evaluate((element) => getComputedStyle(element).color);
  expect(await color(quote)).not.toBe(await color(text));

  const height = async (line: typeof quote) =>
    (await line.boundingBox())?.height;
  const lineHeight = await height(text);
  expect(await height(quote)).toBeCloseTo(lineHeight ?? 0, 0);

  // Its marks where the cursor is, after the bars, on the same height.
  if (info.project.name === "desktop-chromium") await nested.click();
  else await nested.tap();
  await expect(nested).toHaveText("> > and cups");
  await expect(nested).toHaveCSS(
    "background-size",
    `${String(2 * level)}px 100%`,
  );
  expect(await height(nested)).toBeCloseTo(lineHeight ?? 0, 0);
  await expect(quote).toHaveText("Some tea");

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);

  // Return continues the quote, its marks with it.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("milk");
  await expect(lines.nth(6)).toHaveText("> > milk");
  await expect(nested).toHaveText("and cups");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toBe(
    "# The plan\n\nTea.\n\n> Some tea\n> > and cups\n> > milk\n\nCups.\n",
  );
});

test("draws a table in Visual, which a tap shows as written, the row staying under the finger", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  const lines = (from: number) =>
    Array.from({ length: 30 }, (_, line) => `Line ${String(from + line)}.\n`);
  plan.content = [
    "# The plan\n\n",
    ...lines(1),
    "\n| Step | **Owner** |\n| :--- | ---: |\n| Tea | Ada |\n| Cups | Grace |\n\n",
    ...lines(31),
  ].join("");
  const note = await editInVisual(page);
  const table = note.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Step", "Owner"]);
  await expect(table.getByRole("cell")).toHaveText([
    "Tea",
    "Ada",
    "Cups",
    "Grace",
  ]);
  await expect(table.getByRole("cell", { name: "Ada" })).toHaveCSS(
    "text-align",
    "right",
  );

  const cell = table.getByRole("cell", { name: "Ada" });
  // Where the cell stays once the editor has measured the lines that came
  // into view, which may move it.
  const before = await cell.evaluate(async (element) => {
    element.scrollIntoView({ block: "center" });
    let top = Number.NaN;
    for (let still = 0; still < 3;) {
      await new Promise(requestAnimationFrame);
      const now = element.getBoundingClientRect().top;
      still = now === top ? still + 1 : 0;
      top = now;
    }
    return top;
  });
  if (info.project.name === "desktop-chromium") await cell.click();
  else await cell.tap();

  const row = note.locator(".cm-line").filter({ hasText: "| Tea |" });
  await expect(table).toHaveCount(0);
  await expect(row).toBeVisible();
  // The row's top where the cell's was, as far as a pixel.
  await expect
    .poll(async () => (await row.boundingBox())?.y)
    .toBeCloseTo(before, -0.5);

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);

  // The cursor at the cell's end, where typing edits it alone.
  await page.keyboard.type("!");
  await expect(row).toHaveText("| Tea | Ada! |");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toContain(
    "\n| Step | **Owner** |\n| :--- | ---: |\n| Tea | Ada! |\n| Cups | Grace |\n\n",
  );
});

test("scrolls a table wider than a phone within itself", async ({
  page,
  drive,
}, info) => {
  test.skip(info.project.metadata.layout !== "phone", "For a phone");
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  const long = "A rather long cell that takes most of a phone's width";
  plan.content = `# The plan\n\n| One | Two |\n| --- | --- |\n| ${long} | ${long} |\n`;
  const frame = (await editInVisual(page)).locator(".cm-table");
  await expect(frame.getByRole("table")).toBeVisible();

  expect(
    await frame.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
