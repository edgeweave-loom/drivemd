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
  await expect(note.locator("img")).toHaveCount(0);
  // Raw HTML, sanitized as on GitHub.
  await note.getByText("More").click();
  await expect(note.locator("details b")).toHaveText("Bold");
  await expect(note.locator("script, [onclick]")).toHaveCount(0);
  await expect(note).not.toContainText("hidden");
});
