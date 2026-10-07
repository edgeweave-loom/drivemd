import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fake-google.ts";

/** How many notes have unsaved changes kept on the device. */
function draftsKept(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const opening = indexedDB.open("drivemd");
        opening.onsuccess = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains("drafts")) {
            resolve(0);
            return;
          }
          const counting = database
            .transaction("drafts")
            .objectStore("drafts")
            .count();
          counting.onsuccess = () => {
            resolve(counting.result);
          };
        };
      }),
  );
}

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
  // GitHub strikes no checked task through.
  await expect(
    note.getByRole("listitem").filter({ hasText: "Find cups" }),
  ).toHaveCSS("text-decoration-line", "none");
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
  await expect(page).toHaveURL(/\/edit\?id=notes#later$/);
  await expect(page.getByText(/^Last modified by/)).toBeVisible();
  // It opens at the heading the link names, below the app's header.
  const later = page
    .locator(".markdown")
    .getByRole("heading", { name: "Later" });
  await expect(later).toBeInViewport();
  const header = await page.locator("header.bar").boundingBox();
  const heading = await later.boundingBox();
  expect(heading?.y).toBeGreaterThanOrEqual(
    (header?.y ?? 0) + (header?.height ?? 0) - 1,
  );
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
  // Front matter shows as YAML at the text's size, its keys dimmed as
  // Markdown's symbols are.
  const key = source.getByText("tags", { exact: true });
  await expect(key).toHaveCSS(
    "font-size",
    await source.evaluate((element) => getComputedStyle(element).fontSize),
  );
  await expect(key).toHaveCSS(
    "color",
    await source
      .getByText("#", { exact: true })
      .evaluate((element) => getComputedStyle(element).color),
  );
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

test("formats the source from the keyboard toolbar on touch screens", async ({
  page,
  drive,
}, info) => {
  const notes = drive.files.get("notes");
  if (notes) notes.content = "one\ntwo\n";
  await signIn(page);
  await page.goto("/edit?id=notes");

  await page.getByRole("button", { name: "Edit" }).click();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.locator(".cm-line").nth(1).click();
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  if (info.project.name === "desktop-chromium") {
    await expect(source).toBeFocused();
    await expect(toolbar).toHaveCount(0);
    return;
  }
  await expect(toolbar).toBeVisible();
  // Along the screen's bottom edge, where the keyboard would rise.
  const bar = await toolbar.boundingBox();
  expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBe(page.viewportSize()?.height);
  const checkbox = toolbar.getByRole("button", { name: "Checkbox" });
  expect((await checkbox.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await checkbox.tap();
  await expect(source.locator(".cm-line").nth(1)).toHaveText("- [ ] two");
  // The key left the focus, and the keyboard, with the editor.
  await expect(source).toBeFocused();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(String(drive.files.get("notes")?.content)).toBe("one\n- [ ] two\n");
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

test("shows someone else's change at save, and overwrites it when asked", async ({
  page,
  drive,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  // Someone else saves the note meanwhile.
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = `${String(plan.content)}\nTheir line.\n`;
  plan.revision = 2;

  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Someone changed this file in Google Drive",
    }),
  ).toBeVisible();
  await expect(page.locator(".differences .cm-content")).toBeVisible();
  await expect(page.locator(".differences")).toContainText("Their line.");
  expect(drive.writes).toEqual([]);

  await page.getByRole("button", { name: "Overwrite with mine" }).click();
  // The panel goes at once; the writes follow.
  await expect
    .poll(() => drive.writes)
    .toEqual(["keep plan revision-2", "save plan"]);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(String(drive.files.get("plan")?.content)).not.toContain("Their line.");
  expect(String(drive.files.get("plan")?.content)).toContain(
    "- [x] Boil water",
  );
});

test("folds the lines alike in the theme's colors, as the system's changes", async ({
  page,
  drive,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = `${String(plan.content)}\nTheir line.\n`;
  plan.revision = 2;
  await page.getByRole("button", { name: "Save" }).click();

  const folded = page.locator(".differences .cm-collapsedLines").first();
  await expect(folded).toContainText("unchanged lines");
  const colors = () =>
    folded.evaluate((bar) => {
      const style = getComputedStyle(bar);
      return {
        text: style.color,
        // Its color, or a gradient's, but not what it lets through.
        backgrounds: [
          style.backgroundColor,
          ...(style.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []),
        ].filter((color) => !color.endsWith(", 0)")),
      };
    });
  const { text, backgrounds } = await colors();
  expect(backgrounds.length).toBeGreaterThan(0);
  for (const background of backgrounds) {
    expect(luminance(background)).toBeLessThan(0.1);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  }

  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(async () => luminance((await colors()).text))
    .toBeLessThan(0.1);
  for (const background of (await colors()).backgrounds) {
    expect(luminance(background)).toBeGreaterThan(0.5);
  }
});

/** WCAG's relative luminance of a computed `rgb()` color. */
function luminance(color: string): number {
  const channels = /^rgba?\((\d+), (\d+), (\d+)/.exec(color)?.slice(1);
  if (!channels) throw new Error(`Not an rgb() color: ${color}`);
  const [r = 0, g = 0, b = 0] = channels.map((channel) => {
    const c = Number(channel) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

test("keeps unsaved changes on the device across a reload", async ({
  page,
  drive,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // Kept on the device half a second after the last change.
  await expect.poll(() => draftsKept(page)).toBe(1);

  await page.reload();
  await expect(
    page.getByText(/^You have unsaved changes to this note from /),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.locator(".markdown").getByRole("checkbox").first(),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
});

test("lists a note with unsaved changes first on Home, then offers them back", async ({
  page,
  drive,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  await expect.poll(() => draftsKept(page)).toBe(1);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("link", { name: "DriveMD" }).click();
  const unsaved = page.getByRole("region", { name: "Unsaved changes" });
  await expect(page.getByRole("region").first()).toHaveAccessibleName(
    "Unsaved changes",
  );
  await expect(unsaved.getByRole("link")).toHaveText([/^plan\.md/]);
  await expect(
    page.getByRole("region", { name: "Vaults" }).getByRole("link"),
  ).toHaveText(["Journal"]);
  await unsaved.getByRole("link").click();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  await page.getByRole("link", { name: "DriveMD" }).click();
  await expect(
    page.getByRole("region", { name: "Vaults" }).getByRole("link"),
  ).toHaveText(["Journal"]);
  await expect(unsaved).toHaveCount(0);
  expect(drive.writes).toEqual(["keep plan revision-1", "save plan"]);
});

test("signs out once the user agrees to discard unsaved changes", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  await expect.poll(() => draftsKept(page)).toBe(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toContainText("1 note has unsaved changes on this device.");
  await page.getByRole("button", { name: "Discard and sign out" }).click();

  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  expect(await draftsKept(page)).toBe(0);
});

test("asks before leaving a note with unsaved changes for another page", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });

  const refused = page.waitForEvent("dialog");
  void crumbs.getByRole("link", { name: "Work" }).click();
  const asked = await refused;
  expect(asked.message()).toBe(
    "This note has unsaved changes. Leave it anyway?",
  );
  await asked.dismiss();
  await expect(page).toHaveURL(/\/edit\?id=plan$/);
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await crumbs.getByRole("link", { name: "Work" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Work" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Archive" })).toBeVisible();
});
