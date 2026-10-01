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
  await expect(note.getByRole("table")).toContainText("Ada");
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
});
