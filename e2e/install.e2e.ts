import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fake-google.ts";

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/** A PNG's size, and whether it has no alpha channel, from its header. */
function png(bytes: Buffer): { size: string; opaque: boolean } {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  const size = `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
  // Colour type 2 is RGB: iOS fills an icon's transparent pixels with black.
  return { size, opaque: bytes[25] === 2 };
}

async function signInScreen(page: Page): Promise<void> {
  await page.goto("/");
  // Once Google's sign-in script has loaded, so that nothing is left loading.
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeEnabled();
}

async function manifestOf(
  page: Page,
  request: APIRequestContext,
): Promise<{ name: string; icons: Icon[] } & Record<string, unknown>> {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const response = await request.get(href ?? "");
  expect(response.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  return (await response.json()) as Awaited<ReturnType<typeof manifestOf>>;
}

test("names DriveMD as an app that opens on Home, on its own", async ({
  page,
  request,
}) => {
  await signInScreen(page);
  expect(await manifestOf(page, request)).toMatchObject({
    id: "/",
    name: "DriveMD",
    short_name: "DriveMD",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
});

test("gives icons of the sizes they claim, one of them for a mask", async ({
  page,
  request,
}) => {
  await signInScreen(page);
  const { icons } = await manifestOf(page, request);
  for (const icon of icons) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"]).toContain(icon.type);
    if (icon.type === "image/png") {
      expect(png(await response.body()).size).toBe(icon.sizes);
    }
  }
  // Android's launcher and Chrome's install dialog take these.
  const plain = icons.filter(({ purpose }) => purpose === undefined);
  expect(plain.map(({ sizes }) => sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  // Android crops a maskable icon to its own shape.
  expect(
    icons.filter(({ purpose }) => purpose === "maskable").map((i) => i.sizes),
  ).toContain("512x512");
});

test("gives the Home Screen of an iPhone an opaque icon", async ({
  page,
  request,
}) => {
  await signInScreen(page);
  const icon = page.locator('link[rel="apple-touch-icon"]');
  await expect(icon).toHaveAttribute("href", "/apple-touch-icon.png");
  const response = await request.get("/apple-touch-icon.png");
  expect(png(await response.body())).toEqual({
    size: "180x180",
    opaque: true,
  });
});

test("is a manifest Chrome reads without a complaint", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chrome's own reading, through CDP");
  await signInScreen(page);
  const cdp = await page.context().newCDPSession(page);
  // Headless Chrome reports no installability error even for a broken
  // manifest, so only its reading of the manifest is checked here.
  const { url, errors } = await cdp.send("Page.getAppManifest");
  expect(url).toMatch(/\/manifest\.webmanifest$/);
  expect(errors).toEqual([]);
});
