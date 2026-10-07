import { expect, signIn, test } from "./fake-google.ts";

test("sets the app in its own fonts, served under the security policy", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/edit?id=plan");
  const note = page.locator(".markdown");
  const heading = note.getByRole("heading", { level: 1, name: "The plan" });
  await expect(heading).toBeVisible();

  await expect(heading).toHaveCSS("font-family", /^"?Google Sans Flex\b/);
  await expect(note.locator("pre code")).toHaveCSS(
    "font-family",
    /^"?Google Sans Code\b/,
  );
  // The page itself loads the faces of the Latin letters it shows.
  const shown = await page.evaluate(async () => {
    await document.fonts.ready;
    return (
      [...document.fonts]
        // Browsers write the Latin range U+0-FF, or U+0000-00FF.
        .filter((face) => /^U\+0+-0*FF\b/i.test(face.unicodeRange))
        .map((face) => ({
          family: face.family,
          style: face.style,
          status: face.status,
        }))
    );
  });
  for (const family of [/Google Sans Flex/, /Google Sans Code/]) {
    expect(
      shown.some(
        (face) =>
          family.test(face.family) &&
          face.style === "normal" &&
          face.status === "loaded",
      ) ||
        // A face with a range of slants serves upright text too.
        shown.some(
          (face) =>
            family.test(face.family) &&
            face.style.startsWith("oblique 0deg") &&
            face.status === "loaded",
        ),
    ).toBe(true);
  }
  // Emphasis takes each font's own slant, rather than one the browser fakes.
  expect(
    shown.some(
      (face) =>
        /Google Sans Flex/.test(face.family) &&
        /^oblique 0deg \d+deg$/.test(face.style),
    ),
  ).toBe(true);
  expect(
    shown.some(
      (face) => /Google Sans Code/.test(face.family) && face.style === "italic",
    ),
  ).toBe(true);
  // Every face loads from the app's own files, which the policy allows,
  // even those of scripts a note seldom holds: a face the build inlined as
  // a data: address would fail here.
  const faces = await page.evaluate(() =>
    Promise.all(
      [...document.fonts].map((face) =>
        face.load().then(
          () => ({ family: face.family, status: face.status }),
          () => ({ family: face.family, status: "error" }),
        ),
      ),
    ),
  );
  for (const family of [/Google Sans Flex/, /Google Sans Code/]) {
    const statuses = faces
      .filter((face) => family.test(face.family))
      .map((face) => face.status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).toEqual(statuses.map(() => "loaded"));
  }
});
