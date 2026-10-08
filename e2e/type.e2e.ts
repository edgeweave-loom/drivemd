import { token } from "./color.ts";
import { expect, signIn, startEditing, test } from "./fake-google.ts";

const NOTE = [
  "# The plan",
  "",
  "Tea for two, with `cups` warmed first.",
  "",
  "## Steps",
  "",
  "### Water",
  "",
  "#### Cups",
  "",
  "| Step | Owner |",
  "| ---- | ----- |",
  "| Tea  | Ada   |",
  "| Cups | Grace |",
  "",
  "- [ ] Boil water",
  "- [x] Find cups",
  "",
  "```ts",
  "const cups = 2;",
  "```",
  "",
  "---",
  "",
].join("\n");

test("sets a note in the design's type", async ({ page, drive }, info) => {
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = NOTE;
  await signIn(page);
  await page.goto("/edit?id=plan");
  const note = page.locator(".markdown");
  const phone = info.project.metadata.layout === "phone";
  const heading = (level: number) => note.getByRole("heading", { level });
  await expect(heading(1)).toBeVisible();

  // Headings at 500, a step smaller on a phone, without GitHub's rules.
  for (const [level, size, line] of [
    [1, phone ? 28 : 32, phone ? 36 : 40],
    [2, phone ? 22 : 24, phone ? 30 : 32],
    [3, 20, 28],
    [4, 16, 26],
  ] as const) {
    await expect(heading(level)).toHaveCSS("font-size", `${String(size)}px`);
    await expect(heading(level)).toHaveCSS("line-height", `${String(line)}px`);
    await expect(heading(level)).toHaveCSS("font-weight", "500");
    await expect(heading(level)).toHaveCSS("border-bottom-width", "0px");
  }
  const paragraph = note.getByText("Tea for two");
  await expect(paragraph).toHaveCSS("font-size", "16px");
  await expect(paragraph).toHaveCSS("line-height", "26px");
  // Code in Google Sans Code at 14 px, its blocks at 22 px a line.
  const code = note.locator("p code");
  await expect(code).toHaveCSS("font-family", /^"?Google Sans Code Variable\b/);
  await expect(code).toHaveCSS("font-size", "14px");
  const block = note.locator("pre");
  await expect(block).toHaveCSS("font-size", "14px");
  await expect(block).toHaveCSS("line-height", "22px");
  await expect(block).toHaveCSS("border-top-left-radius", "8px");
  // Tables as Drive lists files: a rule under each row, the head quieter.
  const head = note.getByRole("columnheader", { name: "Step" });
  await expect(head).toHaveCSS(
    "color",
    await token(page, "--on-surface-variant"),
  );
  for (const cell of [head, note.getByRole("cell", { name: "Cups" })]) {
    await expect(cell).toHaveCSS("border-left-width", "0px");
    await expect(cell).toHaveCSS("border-bottom-width", "1px");
  }
  await expect(note.getByRole("row").last()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  // Tasks take the accent.
  await expect(note.getByRole("checkbox").first()).toHaveCSS(
    "accent-color",
    await token(page, "--primary"),
  );
  // At most 72 characters a line.
  const measure = await note.evaluate((element) => {
    const probe = element.appendChild(document.createElement("div"));
    probe.style.width = "72ch";
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  expect((await note.boundingBox())?.width).toBeLessThanOrEqual(measure);

  // The source, 16 px on 26 px lines.
  await startEditing(page);
  const line = page.locator(".cm-line").first();
  await expect(line).toHaveCSS("font-size", "16px");
  await expect(line).toHaveCSS("line-height", "26px");
});
