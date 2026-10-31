import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fake-google.ts";

/**
 * Opens a note, plan.md unless told, in Visual: from Edit on a phone, or
 * else from the mode menu.
 */
async function editInVisual(page: Page, id = "plan") {
  await signIn(page);
  await page.goto(`/edit?id=${id}`);
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

test("draws a vault's callout in Visual as the viewer does, its marks shown where the cursor is", async ({
  page,
  drive,
}, info) => {
  const today = drive.files.get("today");
  if (!today) throw new Error("No today");
  today.content = "Tea.\n\n> [!faq]+ Why tea?\n> It wakes me up.\n";
  const lines = (await editInVisual(page, "today")).locator(".cm-line");
  const title = lines.nth(2);
  const body = lines.nth(3);
  await expect(title).toHaveText("Why tea?");
  await expect(body).toHaveText("It wakes me up.");

  // Its type's icon and color, the box under its lines.
  await expect(title.locator(".cm-callout-icon")).toHaveAttribute(
    "data-icon",
    "lucide-circle-question-mark",
  );
  const orange = "rgb(236, 117, 0)";
  await expect(title).toHaveCSS("color", orange);
  for (const line of [title, body]) {
    await expect(line.locator(".cm-frame-box")).toHaveCSS(
      "border-left-color",
      orange,
    );
  }

  // Its marks where the cursor is, on the same height.
  const height = async (line: typeof title) =>
    (await line.boundingBox())?.height;
  const heights = [await height(title), await height(body)];
  const tap = (line: typeof title) =>
    info.project.name === "desktop-chromium" ? line.click() : line.tap();
  await tap(body);
  await expect(body).toHaveText("> It wakes me up.");
  await tap(title);
  await expect(title).toHaveText("> [!faq]+ Why tea?");
  await expect(title.locator(".cm-callout-icon")).toHaveCount(0);
  await expect(body).toHaveText("It wakes me up.");
  expect([await height(title), await height(body)]).toEqual(heights);

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);

  // Return continues the callout, its marks with it.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Milk?");
  await expect(lines.nth(3)).toHaveText("> Milk?");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("today")?.content)).toBe(
    "Tea.\n\n> [!faq]+ Why tea?\n> Milk?\n> It wakes me up.\n",
  );
});

test("folds a vault's callout in Visual as its `-` says, which a tap on its chevron opens, writing nothing", async ({
  page,
  drive,
}, info) => {
  const today = drive.files.get("today");
  if (!today) throw new Error("No today");
  today.content = "Tea.\n\n> [!faq]- Why tea?\n> It wakes me up.\n\nCups.\n";
  const lines = (await editInVisual(page, "today")).locator(".cm-line");
  const title = lines.nth(2);
  const chevron = title.locator(".cm-callout-fold");
  const tap = (target: typeof title) =>
    info.project.name === "desktop-chromium" ? target.click() : target.tap();
  await expect(lines).toHaveText(["Tea.", "", "Why tea?", "", "Cups.", ""]);
  await expect(chevron).toHaveClass(/cm-callout-folded/);
  // A tap target of 44 px.
  const target = await chevron.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);

  await tap(chevron);
  await expect(lines.nth(3)).toHaveText("It wakes me up.");
  await expect(chevron).not.toHaveClass(/cm-callout-folded/);
  await tap(chevron);
  await expect(lines).toHaveText(["Tea.", "", "Why tea?", "", "Cups.", ""]);

  // A tap on the title's line places the cursor on it, the callout staying
  // folded.
  await tap(title.getByText("Why tea?"));
  await expect(title).toHaveText("> [!faq]- Why tea?");
  await expect(lines).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);
});

test("draws a callout in a callout in Visual, a box in the box, its marks shown where the cursor is", async ({
  page,
  drive,
}, info) => {
  const today = drive.files.get("today");
  if (!today) throw new Error("No today");
  today.content = "> [!note] Plan\n> > [!warning] Dates\n> > Friday.\n";
  const lines = (await editInVisual(page, "today")).locator(".cm-line");
  const inner = lines.nth(1);
  await expect(inner).toHaveText("Dates");

  // One level in, as a quote's, in its own color, inside the outer box.
  const [outer, box] = await inner
    .locator(".cm-frame-box")
    .evaluateAll((boxes) =>
      boxes.map((drawn) => drawn.getBoundingClientRect()),
    );
  const em = Number.parseFloat(
    await inner.evaluate((element) => getComputedStyle(element).fontSize),
  );
  expect((box?.left ?? 0) - (outer?.left ?? 0)).toBeCloseTo(1.25 * em, 0);
  expect(box?.right).toBeLessThan(outer?.right ?? 0);
  await expect(inner.locator(".cm-frame-box").nth(1)).toHaveCSS(
    "border-left-color",
    "rgb(236, 117, 0)",
  );

  if (info.project.name === "desktop-chromium") await inner.click();
  else await inner.tap();
  await expect(inner).toHaveText("> > [!warning] Dates");
  await expect(lines.nth(0)).toHaveText("Plan");
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);
});

test("draws a code block in a quote in Visual after its bar, its text 1rem in", async ({
  page,
  drive,
}) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = "> Tea:\n> ```js\n> const tea = 1;\n> ```\n";
  const lines = (await editInVisual(page)).locator(".cm-line");
  const inset = (line: ReturnType<typeof lines.nth>) =>
    line.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft),
    );
  const rem = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(await inset(lines.nth(2))).toBeCloseTo(
    (await inset(lines.nth(0))) + rem,
    0,
  );
});

test("draws a table in a quote in Visual beside its bars, whose cells a tap edits in place", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content =
    "# The plan\n\nTea.\n\n> Cups\n> | Step | Owner |\n>| --- | --- |\n> | Tea | Ada |\n\nCups.\n";
  const note = await editInVisual(page);
  const quote = note.locator(".cm-line").nth(4);
  const frame = note.locator(".cm-table");
  const table = frame.getByRole("table");
  await expect(quote).toHaveText("Cups");
  await expect(table.getByRole("cell")).toHaveText(["Tea", "Ada"]);

  // The quote's bar beside it, as beside the quote's line, the table where
  // the line's text starts, as quiet.
  const em = Number.parseFloat(
    await quote.evaluate((element) => getComputedStyle(element).fontSize),
  );
  await expect(frame).toHaveCSS("background-image", /linear-gradient/);
  await expect(frame).toHaveCSS(
    "background-size",
    `${String(1.25 * em)}px 100%`,
  );
  const [quoteBox, frameBox, tableBox] = await Promise.all([
    quote.boundingBox(),
    frame.boundingBox(),
    table.boundingBox(),
  ]);
  if (!quoteBox || !frameBox || !tableBox) throw new Error("Not shown");
  const inset = Number.parseFloat(
    await quote.evaluate((element) => getComputedStyle(element).paddingLeft),
  );
  expect(frameBox.x).toBeCloseTo(quoteBox.x, 0);
  expect(tableBox.x).toBeCloseTo(quoteBox.x + inset, 0);
  const color = (element: typeof quote) =>
    element.evaluate((one) => getComputedStyle(one).color);
  expect(await color(frame)).toBe(await color(quote));

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);

  // A cell edited in place, then a row added past the last, with the
  // marks of the line before it.
  const cell = table.getByRole("cell", { name: "Ada" });
  if (info.project.name === "desktop-chromium") await cell.click();
  else await cell.tap();
  const editing = note.getByRole("textbox", { name: "Cell" });
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("Ada");
  await page.keyboard.type("!");
  await page.keyboard.press("Tab");
  await expect(editing).toHaveText("");
  await page.keyboard.type("Milk");
  const line = note.locator(".cm-line").filter({ hasText: "Tea." });
  if (info.project.name === "desktop-chromium") await line.click();
  else await line.tap();
  await expect(editing).toHaveCount(0);
  await expect(table.getByRole("cell")).toHaveText(["Tea", "Ada!", "Milk", ""]);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toBe(
    "# The plan\n\nTea.\n\n> Cups\n> | Step | Owner |\n>| --- | --- |\n> | Tea | Ada! |\n> | Milk |  |\n\nCups.\n",
  );
});

test("draws a table in Visual, whose cell a tap edits in place, the table staying drawn", async ({
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
    "\n| Step | **Owner** |\n| :--- | ---: |\n| Tea | _Ada_ |\n| Cups | Grace |\n\n",
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

  // The cell shows its Markdown, focused, in the table still drawn, which
  // stays where it was.
  const editing = note.getByRole("textbox", { name: "Cell" });
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("_Ada_");
  await expect(table.getByRole("columnheader")).toHaveText(["Step", "Owner"]);
  expect((await cell.boundingBox())?.y).toBeCloseTo(before, -0.5);
  if (info.project.metadata.layout !== "wide") {
    const keys = page.getByRole("toolbar", { name: "Formatting" });
    await expect(keys.getByRole("button", { name: "Bold" })).toBeEnabled();
    // The keys of lines give way to the table's.
    await expect(keys.getByRole("button", { name: "Heading" })).toHaveCount(0);
  }

  // Looked at, and written over nowhere: nothing to save.
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(drive.writes).toEqual([]);

  // The cursor at the cell's end, where typing edits it alone, a pipe
  // escaped; Tab edits the next cell.
  await page.keyboard.type(" | Grace");
  await expect(editing).toHaveText("_Ada_ \\| Grace");
  await page.keyboard.press("Tab");
  await expect(editing).toHaveText("Cups");
  await page.keyboard.type("!");
  // The line above the table, which the screen still shows.
  const line = note.locator(".cm-line").filter({ hasText: "Line 30." });
  if (info.project.name === "desktop-chromium") await line.click();
  else await line.tap();
  await expect(editing).toHaveCount(0);
  await expect(table.getByRole("cell")).toHaveText([
    "Tea",
    "Ada | Grace",
    "Cups!",
    "Grace",
  ]);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toContain(
    "\n| Step | **Owner** |\n| :--- | ---: |\n| Tea | _Ada_ \\| Grace |\n| Cups! | Grace |\n\n",
  );
});

test("moves through a table's cells with the arrows, and adds rows past its end", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content =
    "# The plan\n\nA line wider than the table.\n| Step | **Owner** | Left |\n| :--- | ---: | :-: |\n| Tea | _Ada_ | 2 |\n| Cups | Grace | 1 |\n\nNotes.\n";
  const note = await editInVisual(page);
  const table = note.getByRole("table");
  const owner = await table
    .getByRole("columnheader", { name: "Owner" })
    .boundingBox();
  const line = await note
    .locator(".cm-line")
    .filter({ hasText: "A line wider" })
    .boundingBox();
  if (!owner || !line) throw new Error("Not laid out");
  expect(line.width).toBeGreaterThan(
    (await table.boundingBox())?.width ?? Infinity,
  );

  // Down from the line before edits the head's cell under the cursor.
  const x = owner.x + owner.width / 2;
  const y = line.y + line.height / 2;
  if (info.project.name === "desktop-chromium") await page.mouse.click(x, y);
  else await page.touchscreen.tap(x, y);
  await page.keyboard.press("ArrowDown");
  const editing = note.getByRole("textbox", { name: "Cell" });
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("**Owner**");
  // Up leaves for the line before, above the cell's middle, from which Down
  // comes back.
  await page.keyboard.press("ArrowUp");
  await expect(editing).toHaveCount(0);
  await expect(note).toBeFocused();
  await expect(table.getByRole("columnheader")).toHaveText([
    "Step",
    "Owner",
    "Left",
  ]);
  await page.keyboard.press("ArrowDown");
  await expect(editing).toHaveText("**Owner**");

  // Down the column, then Right from the text's end to the next cell's
  // start, and past the last out of the table.
  await page.keyboard.press("ArrowDown");
  await expect(editing).toHaveText("_Ada_");
  await page.keyboard.press("ArrowDown");
  await expect(editing).toHaveText("Grace");
  // To the blank line after the table and back, to the same column.
  await page.keyboard.press("ArrowDown");
  await expect(editing).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(editing).toHaveText("Grace");
  await page.keyboard.press("ArrowRight");
  await expect(editing).toHaveText("1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(editing).toHaveCount(0);
  await expect(note).toBeFocused();
  // Left comes back to the last cell's end.
  await page.keyboard.press("ArrowLeft");
  await expect(editing).toHaveText("1");
  await page.keyboard.type("0");

  // Tab past the last cell adds a row; Shift+Enter writes <br>, which the
  // cell left draws as a line break; Enter on the last row adds another
  // row, in the same column.
  await page.keyboard.press("Tab");
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("");
  await page.keyboard.type("Milk");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("oat");
  await expect(editing).toHaveText("Milk<br>oat");
  await page.keyboard.press("Enter");
  await expect(editing).toHaveText("");
  await page.keyboard.type("Sugar");
  await expect(table.getByRole("row")).toHaveCount(5);
  const milk = table.getByRole("row").nth(3).getByRole("cell").first();
  await expect
    .poll(() => milk.evaluate((cell: HTMLElement) => cell.innerText))
    .toBe("Milk\noat");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toBe(
    "# The plan\n\nA line wider than the table.\n| Step | **Owner** | Left |\n| :--- | ---: | :-: |\n| Tea | _Ada_ | 2 |\n| Cups | Grace | 10 |\n| Milk<br>oat |  |  |\n| Sugar |  |  |\n\nNotes.\n",
  );
});

test("edits a table's rows and columns from its menu or the keyboard toolbar's keys", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content =
    "# The plan\n\n| Step | Owner |\n| --- | --- |\n| Tea | Ada |\n| Cups | Grace |\n\nNotes.\n";
  const note = await editInVisual(page);
  const table = note.getByRole("table");
  const editing = note.getByRole("textbox", { name: "Cell" });
  const menu = page.getByRole("menu", { name: "Table" });
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const options = toolbar.getByRole("button", { name: "Table options" });
  const mouse = info.project.name === "desktop-chromium";
  const ada = table.getByRole("cell", { name: "Ada" });
  /**
   * Opens the menu from the Table options key, which shows above it, its
   * right edge with the key's, or with the screen's where the key runs past
   * it, under the app bar, the cell keeping the focus, and the keyboard.
   */
  const fromKey = async (open: () => Promise<void>) => {
    await open();
    await expect(menu).toBeVisible();
    const [shown, key, bar] = await Promise.all([
      menu.boundingBox(),
      options.boundingBox(),
      page.getByRole("banner").boundingBox(),
    ]);
    const width = page.viewportSize()?.width;
    if (!shown || !key || !bar || !width) throw new Error("Not laid out");
    expect(shown.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(shown.y + shown.height).toBeLessThanOrEqual(key.y);
    expect(shown.y + shown.height).toBeGreaterThan(key.y - 8);
    expect(shown.x + shown.width).toBeCloseTo(
      Math.min(key.x + key.width, width - 8),
      0,
    );
    await expect(editing).toBeFocused();
  };

  if (mouse) {
    await ada.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(editing).toHaveText("Ada");
    await expect(
      menu.getByRole("menuitem", { name: "Insert line break" }),
    ).toBeFocused();
  } else {
    await ada.tap();
    await expect(editing).toBeFocused();
    // Undo and Redo first, then the table's own keys.
    await expect(toolbar.getByRole("button").nth(1)).toHaveAccessibleName(
      "Redo",
    );
    await expect(toolbar.getByRole("button").nth(2)).toHaveAccessibleName(
      "Add row below",
    );
    // Table options held at the row's right end; where the keys before it
    // scroll, as on a phone held upright, the last one in view is cut in
    // its middle, which tells that they do.
    const held = await options.boundingBox();
    expect(held?.width).toBe(44);
    expect((held?.x ?? 0) + (held?.width ?? 0)).toBe(
      page.viewportSize()?.width,
    );
    const { scrolls, cut } = await toolbar.locator(".keys").evaluate((row) => {
      const edge = row.getBoundingClientRect().right;
      const key = [...row.querySelectorAll("button")]
        .map((button) => button.getBoundingClientRect())
        .find(({ left, right }) => left < edge && right > edge);
      return {
        scrolls: row.scrollWidth > row.clientWidth,
        cut: key ? (edge - key.left) / key.width : null,
      };
    });
    expect(scrolls).toBe(info.project.name === "iphone-webkit");
    if (scrolls) expect(cut).toBeCloseTo(0.5, 1);
    await fromKey(() => options.click());
  }
  const pick = async (name: string) => {
    const key = toolbar.getByRole("button", { name });
    if (!mouse && (await key.count()) > 0) {
      await key.click();
    } else {
      if (!(await menu.isVisible())) {
        if (mouse) await editing.click({ button: "right" });
        else await options.click();
      }
      await menu
        .getByRole(name.startsWith("Align") ? "menuitemradio" : "menuitem", {
          name,
        })
        .click();
      await expect(menu).toBeHidden();
    }
    await expect(editing).toBeFocused();
  };
  await menu.getByRole("menuitem", { name: "Add column to the left" }).click();
  await expect(menu).toBeHidden();
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("");
  await page.keyboard.type("2");
  await pick("Align center");
  await expect(table.getByRole("columnheader").nth(1)).toHaveCSS(
    "text-align",
    "center",
  );
  if (!mouse) {
    await expect(
      toolbar.getByRole("button", { name: "Align center" }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await pick("Move row down");
  await expect(editing).toHaveText("2");
  if (mouse) {
    // From the keyboard too, and Escape gives the cell the focus back.
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(editing).toBeFocused();
  } else if (info.project.name === "ipad-webkit") {
    // A trackpad's right-click, which WebKit asks the menu for as the press
    // starts, and would close it as it ends, with all the items.
    await table.getByRole("cell", { name: "Grace" }).click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(11);
    await expect(editing).toHaveText("Grace");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(editing).toBeFocused();
    // Then above the key again.
    await fromKey(() => options.click());
    await page.keyboard.press("Escape");
  } else {
    // Its key held where it was as the keys scroll to their end.
    await toolbar.locator(".keys").evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
    });
    await fromKey(() => options.click());
    await page.keyboard.press("Escape");
  }
  await expect(menu).toBeHidden();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toBe(
    "# The plan\n\n| Step |  | Owner |\n| --- | :-: | --- |\n| Cups |  | Grace |\n| Tea | 2 | Ada |\n\nNotes.\n",
  );
});

test("writes a line break in a table's cell from its menu, which a phone's keyboard has no Shift+Enter for", async ({
  page,
  drive,
}, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content =
    "# The plan\n\n| Step | Owner |\n| --- | --- |\n| Tea | Ada |\n\nNotes.\n";
  const note = await editInVisual(page);
  const table = note.getByRole("table");
  const editing = note.getByRole("textbox", { name: "Cell" });
  const menu = page.getByRole("menu", { name: "Table" });
  const item = menu.getByRole("menuitem", { name: "Insert line break" });
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const mouse = info.project.name === "desktop-chromium";
  const shortcut = () =>
    item.evaluate((one) => getComputedStyle(one, "::after").content);
  const ada = table.getByRole("cell", { name: "Ada" });
  if (mouse) await ada.click();
  else await ada.tap();
  await page.keyboard.type("!");

  if (mouse) {
    // Past the text's end, where the cursor stays.
    const box = await editing.boundingBox();
    if (!box) throw new Error("Not laid out");
    await editing.click({
      button: "right",
      position: { x: box.width - 1, y: box.height / 2 },
    });
    await expect(item).toBeFocused();
    // Its shortcut shows at its end, out of its name.
    await expect(item).toHaveAccessibleName("Insert line break");
    expect(await shortcut()).toContain("Shift+Enter");
  } else {
    await toolbar.getByRole("button", { name: "Table options" }).click();
    await expect(menu).toBeVisible();
    expect(await shortcut()).toBe("none");
  }
  await item.click();
  await expect(menu).toBeHidden();
  await expect(editing).toBeFocused();
  await expect(editing).toHaveText("Ada!<br>");
  // Undo takes it back alone.
  const undo = (name: "Undo" | "Redo") =>
    mouse
      ? page.keyboard.press(
          name === "Undo" ? "ControlOrMeta+z" : "ControlOrMeta+y",
        )
      : toolbar.getByRole("button", { name }).click();
  await undo("Undo");
  await expect(editing).toHaveText("Ada!");
  await undo("Redo");
  await expect(editing).toHaveText("Ada!<br>");
  await page.keyboard.type("Lovelace");
  await expect(editing).toBeFocused();

  const heading = note.getByText("The plan");
  if (mouse) await heading.click();
  else await heading.tap();
  await expect(editing).toHaveCount(0);
  await expect
    .poll(() =>
      table
        .getByRole("cell")
        .nth(1)
        .evaluate((cell: HTMLElement) => cell.innerText),
    )
    .toBe("Ada!\nLovelace");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  expect(String(drive.files.get("plan")?.content)).toBe(
    "# The plan\n\n| Step | Owner |\n| --- | --- |\n| Tea | Ada!<br>Lovelace |\n\nNotes.\n",
  );
});

test("scrolls the cell a key moves to into view, sideways too", async ({
  page,
  drive,
}, info) => {
  // Thirty cells edited one after the other, slow in WebKit.
  test.slow();
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  const wide = "A rather long cell that takes most of a phone's width";
  const rows = Array.from(
    { length: 30 },
    (_, row) => `| ${String(row + 1)} | ${wide} | Last ${String(row + 1)} |\n`,
  );
  plan.content = `# The plan\n\n| One | Two | Three |\n| --- | --- | --- |\n${rows.join("")}\nNotes.\n`;
  const note = await editInVisual(page);
  const first = note.getByRole("cell", { name: "1", exact: true });
  if (info.project.name === "desktop-chromium") await first.click();
  else await first.tap();
  const editing = note.getByRole("textbox", { name: "Cell" });
  const edited = note.locator(".cm-cell-edited");
  await expect(editing).toHaveText("1");
  await expect(
    note.getByRole("cell", { name: "30", exact: true }),
  ).not.toBeInViewport();

  for (let row = 1; row < 30; row++) await page.keyboard.press("ArrowDown");
  await expect(editing).toHaveText("30");
  await expect(edited).toBeInViewport();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(editing).toHaveText("Last 30");
  await expect(edited).toBeInViewport();
  // A row added, its first cell back at the table's start.
  await page.keyboard.press("Tab");
  await expect(editing).toHaveText("");
  await expect(edited).toBeInViewport();
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

test("scrolls a table in a quote sideways clear of its bars", async ({
  page,
  drive,
}, info) => {
  test.skip(info.project.metadata.layout !== "phone", "For a phone");
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  const long = "A rather long cell that takes most of a phone's width";
  plan.content = `# The plan\n\n> > | One | Two |\n> > | --- | --- |\n> > | ${long} | ${long} |\n`;
  const frame = (await editInVisual(page)).locator(".cm-table");
  await expect(frame.getByRole("table")).toBeVisible();

  // Scrolled, its cells pass under neither bar, which stays where it was.
  const bars = await frame.evaluate((element) => {
    element.scrollLeft = 200;
    const { left, top, height } = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const start = left + Number.parseFloat(style.backgroundPositionX);
    const level = Number.parseFloat(style.backgroundSize) / 2;
    const root = element.getRootNode() as ShadowRoot;
    return [start + 1, start + level + 1].map(
      (x) => root.elementFromPoint(x, top + height / 2) === element,
    );
  });
  expect(bars).toEqual([true, true]);
});
