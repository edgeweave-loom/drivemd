import type { Locator } from "@playwright/test";
import { computed, token } from "./color.ts";
import { expect, signIn, test } from "./fake-google.ts";

/** The colors a control shows: its container, label and outline. */
async function looks(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      height: element.getBoundingClientRect().height,
      radius: Number.parseFloat(style.borderTopLeftRadius),
    };
  });
}

test("gives each action the emphasis its weight calls for", async ({
  page,
  drive,
}, info) => {
  await page.goto("/");
  const signInButton = page.getByRole("button", {
    name: "Sign in with Google",
  });
  await expect(signInButton).toBeEnabled();
  // Filled for the one main action of a view: a pill 40 px tall.
  expect(await looks(signInButton)).toMatchObject({
    background: await token(page, "--primary"),
    color: await token(page, "--on-primary"),
    height: 40,
  });
  expect((await looks(signInButton)).radius).toBeGreaterThanOrEqual(20);

  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  // Tonal for a frequent one, where it does not float as on a phone.
  const create = page.getByRole("button", { name: "New note" });
  if (info.project.metadata.layout !== "phone") {
    expect(await looks(create)).toMatchObject({
      background: await token(page, "--secondary-container"),
      color: await token(page, "--on-secondary-container"),
    });
  }
  // Outlined for the safe way out of a choice.
  await create.click();
  const dialog = page.getByRole("dialog");
  expect(
    await looks(dialog.getByRole("button", { name: "Cancel" })),
  ).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    color: await token(page, "--primary"),
    border: await token(page, "--outline"),
  });
  // An action that will come back once it may: on-surface at 38% on 12%.
  await dialog.getByRole("textbox").fill("");
  const disabled = dialog.getByRole("button", { name: "Create" });
  await expect(disabled).toBeDisabled();
  expect(await looks(disabled)).toMatchObject({
    background: await computed(
      page,
      "color-mix(in srgb, var(--on-surface) 12%, transparent)",
    ),
    color: await computed(
      page,
      "color-mix(in srgb, var(--on-surface) 38%, transparent)",
    ),
  });
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Danger only to confirm a loss.
  await page.goto("/edit?id=plan");
  await page.locator(".markdown").getByRole("checkbox").first().check();
  const plan = drive.files.get("plan");
  if (!plan) throw new Error("No plan");
  plan.content = `${String(plan.content)}\nTheir line.\n`;
  plan.revision = 2;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Keep the Drive version" }).click();
  expect(
    await looks(page.getByRole("button", { name: "Drop my changes" })),
  ).toMatchObject({
    background: await token(page, "--error"),
    color: await token(page, "--on-error"),
  });
});

test("keeps a touch target of 48 px around a 40 px button on a touch screen", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("button", { name: "New note" }).click();
  const cancel = page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" });
  const box = await cancel.boundingBox();
  if (!box) throw new Error("Not shown");
  expect(box.height).toBe(40);
  const touch = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  // Just above the button's edge: part of its target on a touch screen only.
  const hit = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x ?? 0, y ?? 0)?.closest("button")?.textContent,
    [box.x + box.width / 2, box.y - 3],
  );
  expect(hit === "Cancel").toBe(touch);
});

test("rings the control the keyboard reaches", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "My Drive" }).click();
  const create = page.getByRole("button", { name: "New note" });
  await create.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(create).toBeFocused();
  await expect(create).toHaveCSS("outline-style", "solid");
  await expect(create).toHaveCSS("outline-width", "2px");
  await expect(create).toHaveCSS("outline-offset", "2px");
  await expect(create).toHaveCSS(
    "outline-color",
    await token(page, "--primary"),
  );
});

test("dims a row or a link while it cannot be used", async ({ page }) => {
  await signIn(page);
  const looks = await page.evaluate(() =>
    ["entry", "link"].map((kind) => {
      const button = document.body.appendChild(
        document.createElement("button"),
      );
      button.className = kind;
      button.disabled = true;
      const color = getComputedStyle(button).color;
      button.remove();
      return color;
    }),
  );
  const dimmed = await computed(
    page,
    "color-mix(in srgb, var(--on-surface) 38%, transparent)",
  );
  expect(looks).toEqual([dimmed, dimmed]);
});
