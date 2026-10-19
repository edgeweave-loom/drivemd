import { token } from "./color.ts";
import { expect, signIn, startEditing, test } from "./fake-google.ts";

test("reads a note on a sheet, as Docs shows a page, on a wide screen", async ({
  page,
}, info) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  const note = page.locator(".markdown");
  await expect(
    note.getByRole("heading", { level: 1, name: "The plan" }),
  ).toBeVisible();
  const sheet = page.locator(".sheet").filter({ has: note });
  const root = page.locator(":root");
  const bar = page.getByRole("banner");
  if (info.project.metadata.layout === "phone") {
    // A phone reads the note on its surface, from edge to gutter.
    await expect(root).toHaveCSS(
      "background-color",
      await token(page, "--surface"),
    );
    await expect(sheet).toHaveCSS("box-shadow", "none");
    await expect(sheet).toHaveCSS("padding-left", "0px");
    return;
  }
  // The sheet is raised over the app's background, which the bar shares.
  await expect(root).toHaveCSS(
    "background-color",
    await token(page, "--app-background"),
  );
  await expect(bar).toHaveCSS(
    "background-color",
    await token(page, "--app-background"),
  );
  await expect(bar).toHaveCSS("border-bottom-width", "0px");
  await expect(sheet).toHaveCSS(
    "background-color",
    await token(page, "--sheet"),
  );
  await expect(sheet).not.toHaveCSS("box-shadow", "none");
  await expect(sheet).toHaveCSS("padding-top", "64px");
  await expect(sheet).toHaveCSS("padding-left", "72px");
  await expect(sheet).toHaveCSS("padding-right", "72px");
  await expect(sheet).toHaveCSS("border-top-left-radius", "12px");
  await expect(sheet).toHaveCSS("border-bottom-left-radius", "0px");

  const viewport = page.viewportSize();
  const box = await sheet.boundingBox();
  if (!viewport || !box) throw new Error("No sheet on the screen");
  // As wide as a page in Docs where the screen has room for it.
  expect(box.width).toBe(Math.min(816, viewport.width - 32));
  if (info.project.metadata.layout !== "wide") return;
  // Centered in the room the folder pane leaves it.
  const pane = await page
    .getByRole("complementary", { name: "Work" })
    .boundingBox();
  if (!pane) throw new Error("No folder pane beside the note");
  const left = box.x - (pane.x + pane.width);
  const right = viewport.width - 16 - (box.x + box.width);
  expect(left).toBeGreaterThan(0);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test("ends a short note's sheet at the window's bottom, under what heads it", async ({
  page,
  drive,
}, info) => {
  test.skip(info.project.metadata.layout === "phone", "A phone has no sheet");
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  // Its mixed line breaks put a badge above it, which says why it only shows.
  plan.content = "# Short\r\n\nOne line.\n";
  await signIn(page);
  await page.goto("/edit?id=plan");
  const sheet = page.locator(".sheet");
  await expect(sheet.getByRole("heading", { name: "Short" })).toBeVisible();
  const badge = page.getByText("Mixed line breaks");
  await expect(badge).toBeVisible();

  const viewport = page.viewportSize();
  const [box, above] = await Promise.all([
    sheet.boundingBox(),
    badge.boundingBox(),
  ]);
  if (!viewport || !box || !above) throw new Error("Nothing on the screen");
  // Down to the window's bottom, and no further, whatever sits above it.
  expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    viewport.height,
  );
  // What heads the sheet lines up with it.
  expect(above.y + above.height).toBeLessThanOrEqual(box.y);
  expect(above.x).toBeCloseTo(box.x, 0);
});

test("edits a note on two sheets side by side, on a wide screen", async ({
  page,
}, info) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await expect(
    page.locator(".markdown").getByRole("heading", { name: "The plan" }),
  ).toBeVisible();
  await startEditing(page);
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toBeVisible();
  const editor = page.locator(".cm-editor");
  const line = page.locator(".cm-line").first();
  // The source runs on the sheet or the surface, without a frame of its own.
  await expect(editor).toHaveCSS("border-top-width", "0px");
  await expect(editor).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Its focus shows on the cursor's line, as in Docs, rather than as a ring,
  // marked at its start in the focus ring's color.
  await line.click();
  await expect(editor).toHaveCSS("outline-style", "none");
  const active = page.locator(".cm-activeLine");
  await expect(active).toHaveCSS(
    "background-color",
    await token(page, "--surface-container-low"),
  );
  await expect(active).toHaveCSS(
    "box-shadow",
    `${await token(page, "--primary")} 2px 0px 0px 0px inset`,
  );

  const sheets = page
    .getByRole("main")
    .getByRole("region", { name: /^(Markdown|Preview)$/ });
  if (info.project.metadata.layout === "phone") {
    // A phone shows one of them at a time, which a button switches.
    await expect(sheets).toHaveCount(0);
    // From edge to edge of the page, its text in the page's gutter.
    const [box, main] = await Promise.all([
      editor.boundingBox(),
      page.getByRole("main").boundingBox(),
    ]);
    expect(box?.x).toBe(main?.x);
    expect(box?.width).toBe(main?.width);
    await expect(line).toHaveCSS("padding-left", "16px");
    return;
  }
  // The source, then the preview, each on a sheet it names.
  await expect(sheets).toHaveCount(2);
  await expect(sheets.first()).toHaveAccessibleName("Markdown");
  await expect(sheets.last()).toHaveAccessibleName("Preview");
  await expect(sheets.first().locator(".label")).toHaveText("Markdown");
  await expect(sheets.first().locator(".cm-editor")).toHaveCount(1);
  await expect(sheets.last().locator(".markdown")).toHaveCount(1);
  for (const sheet of await sheets.all()) {
    await expect(sheet).toHaveCSS(
      "background-color",
      await token(page, "--sheet"),
    );
    await expect(sheet).not.toHaveCSS("box-shadow", "none");
  }
  const [first, last] = await Promise.all(
    [sheets.first(), sheets.last()].map((sheet) => sheet.boundingBox()),
  );
  if (!first || !last) throw new Error("No sheets on the screen");
  // Side by side, sharing the width.
  expect(last.y).toBe(first.y);
  expect(last.width).toBe(first.width);
  expect(last.x).toBeGreaterThan(first.x + first.width);
  // The source's lines run from edge to edge of their sheet, and their text
  // lines up with the preview's.
  const inset = info.project.metadata.layout === "wide" ? "32px" : "24px";
  await expect(sheets.last()).toHaveCSS("padding-left", inset);
  await expect(line).toHaveCSS("padding-left", inset);
  expect((await editor.boundingBox())?.x).toBe(first.x);
  expect((await editor.boundingBox())?.width).toBe(first.width);
});
