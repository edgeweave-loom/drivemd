import { expect, signIn, test } from "./fake-google.ts";

test("renders a note as GitHub does, under the security policy", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");

  const note = page.locator(".markdown");
  await expect(
    note.getByRole("heading", { level: 1, name: "The plan" }),
  ).toBeVisible();
  await expect(note.getByRole("table").first()).toContainText("tea, cups");
  await expect(note.getByRole("table").last()).toContainText("Ada");
  // Named character references decode without an HTML sink, which Trusted
  // Types would refuse.
  await expect(note).toContainText("Tea & cups © Ada\u00a0Lovelace.");
  await expect(note.getByRole("checkbox")).toHaveCount(2);
  await expect(note.locator("pre code .hljs-keyword")).toHaveText("const");
  const docs = note.getByRole("link", { name: "the docs" });
  await expect(docs).toHaveAttribute("target", "_blank");
  await expect(docs).toHaveAttribute("rel", "noreferrer");
  // Images on other sites are links, never loaded.
  await expect(
    note.getByRole("link", { name: "Image: a chart" }),
  ).toHaveAttribute("href", "https://example.com/chart.png");
  await expect(note.locator('img[src^="http"]')).toHaveCount(0);
  // Relative links lead where their path does in Drive, once they come near
  // the screen.
  await note.getByText(/^Next:/).scrollIntoViewIfNeeded();
  await expect(note.getByText("nothing")).toHaveClass("unresolved");
  await expect(note.getByRole("link", { name: "a photo" })).toHaveAttribute(
    "href",
    "https://drive.google.com/file/d/photo/view",
  );
  await expect(note.getByRole("link", { name: "the archive" })).toHaveAttribute(
    "href",
    "/folder/archive",
  );
  // An image from Drive, read with the token and shown as an object URL.
  const photo = note.getByRole("img", { name: "The photo" });
  await photo.scrollIntoViewIfNeeded();
  await expect(photo).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  // Raw HTML, sanitized as on GitHub.
  await note.getByText("More").click();
  await expect(note.locator("details b")).toHaveText("Bold");
  await expect(note.locator("script, [onclick]")).toHaveCount(0);
  await expect(note).not.toContainText("hidden");
});

test("opens a note a relative link leads to", async ({ page }) => {
  await signIn(page);
  await page.goto("/edit?id=plan");

  const note = page.locator(".markdown");
  await note.getByText(/^Next:/).scrollIntoViewIfNeeded();
  await note.getByRole("link", { name: "the notes" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "notes.md" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/edit\?id=notes$/);
  await expect(page.getByText(/^Last modified by/)).toBeVisible();
  // Its content has come too, before the test leaves the page.
  await expect(page.locator(".markdown")).toBeAttached();
});

test("checks a task and saves that change only", async ({ page, drive }) => {
  const before = String(drive.files.get("plan")?.content);
  await signIn(page);
  await page.goto("/edit?id=plan");

  await page.locator(".markdown").getByRole("checkbox").first().check();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await expect(
    page.locator(".markdown").getByRole("checkbox").first(),
  ).toBeChecked();
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
  expect(String(drive.files.get("plan")?.content)).toBe(
    before.replace("- [ ] Boil water", "- [x] Boil water"),
  );
});

test("edits the source and saves it", async ({ page, drive }, info) => {
  const before = String(drive.files.get("plan")?.content);
  await signIn(page);
  await page.goto("/edit?id=plan");

  await page.getByRole("button", { name: "Edit" }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  // On iOS, CodeMirror waits for the keyboard's own Enter to reach the page
  // before it continues the line: the next key waits for the new line.
  const lines = source.locator(".cm-line");
  const count = await lines.count();
  await page.keyboard.press("Enter");
  await expect(lines).toHaveCount(count + 1);
  await page.keyboard.type("Green tea.");
  if (info.project.name.startsWith("iphone")) {
    await page.getByRole("button", { name: "Preview" }).click();
  }
  await expect(
    page.locator(".markdown p").filter({ hasText: "Green tea." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(String(drive.files.get("plan")?.content)).toBe(
    `${before}\nGreen tea.`,
  );
});

test("keeps one kind of line break whatever an input method types", async ({
  page,
  drive,
}) => {
  const notes = drive.files.get("notes");
  if (notes) notes.content = "one\ntwo\n";
  await signIn(page);
  await page.goto("/edit?id=notes");

  await page.getByRole("button", { name: "Edit" }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  // As an input method, or a phone keyboard typing copied text, inserts it.
  await page.keyboard.insertText("A\r\nB\rC\u0000");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(String(drive.files.get("notes")?.content)).toBe("oneA\nB\nC\ntwo\n");
});

test("saves with Ctrl+S, and follows a link with Ctrl+click in the source", async ({
  page,
  drive,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "Keyboard and mouse shortcuts are for desktops",
  );
  const before = String(drive.files.get("plan")?.content);
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.getByRole("button", { name: "Edit" }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Tea.");

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(String(drive.files.get("plan")?.content)).toBe(`${before}Tea.`);

  await source.getByText("the notes", { exact: true }).click({
    modifiers: ["ControlOrMeta"],
  });
  await expect(
    page.getByRole("heading", { level: 2, name: "notes.md" }),
  ).toBeVisible();
  await expect(page.getByText(/^Last modified by/)).toBeVisible();
  await expect(page.locator(".markdown")).toBeAttached();
});
