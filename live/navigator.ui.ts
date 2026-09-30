import { test as base, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createDrive, type Drive, type DriveAuth } from "../src/drive.ts";
import {
  driveApi,
  FOLDER,
  FROM_ANOTHER,
  INDEX_INTERVAL_MS,
  INDEX_TIMEOUT_MS,
  SHARED_DRIVE,
  SHORTCUT,
} from "./drive-api.ts";
import { configDir, liveSession } from "./grant.ts";

// The deployed app on the real Drive, as the test account (see "Live Drive
// checks" in the README). The session is handed to the page as a sign-in
// would leave it, so Google's window never opens. The checks make what they
// need in a folder of their own and trash it at the end.

/** Starts the name of everything the run makes. */
const RUN = `dmui${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
/** Waits for Drive's search index, which can lag. */
const INDEX = {
  timeout: INDEX_TIMEOUT_MS,
  intervals: [INDEX_INTERVAL_MS],
};
/** Leaves room for a whole wait on Drive's index. */
const INDEX_TEST_TIMEOUT_MS = INDEX_TIMEOUT_MS + 60_000;
// A token just minted lives an hour; the app asks for Continue in its last
// 5 minutes, which a test cannot tap.
const TOKEN_LIFETIME_MS = 50 * 60_000;

interface Run {
  /** The run's folder, named after the browser, which makes its own. */
  name: string;
  account: string;
  auth: DriveAuth;
  drive: Drive;
  /** The IDs of what the run made, by role. */
  ids: Record<"folder" | "notes" | "note" | "archive" | "vault", string>;
}

const test = base.extend<{ run: Run }, { liveRun: Run | undefined }>({
  liveRun: [
    async ({ browserName }, use) => {
      const session = await liveSession(configDir());
      if (!session) {
        await use(undefined);
        return;
      }
      const name = `DriveMD live check ${RUN} ${browserName}`;
      const api = driveApi(session.auth);
      const folder = await api.make({ name, mimeType: FOLDER });
      // Whatever happens next, what the run made goes to the trash.
      const drive = createDrive(session.auth);
      try {
        const ids = await fill(api, drive, folder);
        await use({
          name,
          account: session.account,
          auth: session.auth,
          drive,
          ids,
        });
      } finally {
        await drive.trashFile({ id: folder });
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],
  run: async ({ liveRun }, use, testInfo) => {
    testInfo.skip(!liveRun, "needs the test account's grant: see the README");
    if (liveRun) await use(liveRun);
  },
  page: async ({ page, run, baseURL }, use) => {
    // A token minted for this page, whose lifetime is known.
    run.auth.forget(await run.auth.token());
    const token = await run.auth.token();
    // Only the app's own pages get the session, never a frame or page from
    // another site.
    await page.addInitScript(
      ({ origin, account, token, expiresAt }) => {
        if (location.origin !== origin) return;
        localStorage.setItem("drivemd.account", account);
        sessionStorage.setItem(
          "drivemd.token",
          JSON.stringify({ accessToken: token, expiresAt }),
        );
      },
      {
        origin: new URL(baseURL ?? "").origin,
        account: run.account,
        token,
        expiresAt: Date.now() + TOKEN_LIFETIME_MS,
      },
    );
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await page.exposeFunction(
      "reportViolation",
      (directive: string, source: string) => {
        // Google's script inlines styles for widgets the app does not use,
        // which the policy blocks, as it should.
        const google = source.startsWith("https://accounts.google.com/");
        if (!(google && directive.startsWith("style-src"))) {
          problems.push(`blocked by ${directive} from ${source || "the page"}`);
        }
      },
    );
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        if (event.disposition === "report") return;
        const report = (
          window as { reportViolation?: (d: string, s: string) => void }
        ).reportViolation;
        report?.(event.effectiveDirective, event.sourceFile);
      });
    });
    await use(page);
    expect(problems).toEqual([]);
  },
});

/** Makes a folder, a note, a shortcut to it, a vault and a note in it. */
async function fill(
  api: ReturnType<typeof driveApi>,
  drive: Drive,
  folder: string,
): Promise<Run["ids"]> {
  const inRun = { parents: [folder] };
  const notes = await api.make({
    name: `${RUN} Notes`,
    mimeType: FOLDER,
    ...inRun,
  });
  const archive = await api.make({
    name: `${RUN} Archive`,
    mimeType: FOLDER,
    ...inRun,
  });
  const vault = await api.make({
    name: `${RUN} Vault`,
    mimeType: FOLDER,
    ...inRun,
  });
  const note = (await drive.createFile({ id: notes }, `${RUN} note`)).id;
  await api.make({ name: ".obsidian", mimeType: FOLDER, parents: [vault] });
  await drive.createFile({ id: vault }, `${RUN} daily`);
  await api.make({
    name: `${RUN} Linked note.md`,
    mimeType: SHORTCUT,
    shortcutDetails: { targetId: note },
    ...inRun,
  });
  return { folder, notes, note, archive, vault };
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { level: 2, name, exact: true });
}

function crumbs(page: Page) {
  return page
    .getByRole("navigation", { name: "Breadcrumbs" })
    .getByRole("link");
}

/**
 * Waits until the page's lists have come: leaving a page while Drive answers
 * cancels the calls, which WebKit reports as page errors.
 */
async function loaded(page: Page) {
  await expect(page.getByText("Opening your session…")).toHaveCount(0);
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

/** Opens Home, and waits for Recent and the vaults. */
async function openHome(page: Page) {
  await page.goto("/");
  await expect(heading(page, "Home")).toBeVisible();
  await loaded(page);
}

async function openRunFolder(page: Page, run: Run) {
  await page.goto("/");
  await page.getByRole("link", { name: "My Drive" }).click();
  await page.getByRole("link", { name: run.name, exact: true }).click();
  await expect(heading(page, run.name)).toBeVisible();
  await loaded(page);
}

test.describe.configure({ mode: "serial" });

test("reaches a note in My Drive, through its folders", async ({
  page,
  run,
}) => {
  await openRunFolder(page, run);
  await page.getByRole("link", { name: `${RUN} Notes`, exact: true }).click();
  // Opening the note marks it viewed, which the next check reads on Home.
  const viewed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes(`/files/${run.ids.note}?`),
  );
  await page
    .getByRole("link", { name: `${RUN} note.md` })
    .first()
    .click();
  await expect(heading(page, `${RUN} note.md`)).toBeVisible();
  await expect(page.getByText(/^Last modified/)).toBeVisible();
  await expect(crumbs(page)).toHaveText([
    "Home",
    "My Drive",
    run.name,
    `${RUN} Notes`,
  ]);
  expect((await viewed).ok()).toBe(true);
});

test("lists the note on Home's Recent once viewed", async ({ page }) => {
  test.setTimeout(INDEX_TEST_TIMEOUT_MS);
  // Drive shows a new viewing time a few seconds after the app sets it.
  await expect(async () => {
    await openHome(page);
    await expect(
      page
        .getByRole("region", { name: "Recent" })
        .getByRole("link", { name: `${RUN} note.md` }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass(INDEX);
});

test("finds the note by the start of a word of its name", async ({ page }) => {
  test.setTimeout(INDEX_TEST_TIMEOUT_MS);
  // Drive's search index can take a while to see a new file.
  await expect(async () => {
    await page.goto(`/search?q=${RUN.slice(0, -2)}`);
    await loaded(page);
    await expect(
      page.getByRole("link", { name: `${RUN} note.md` }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass(INDEX);
});

test("reaches a note behind a shortcut", async ({ page, run }) => {
  await openRunFolder(page, run);
  await page.getByRole("link", { name: `${RUN} Linked note.md` }).click();
  await expect(page).toHaveURL(new RegExp(`/edit\\?id=${run.ids.note}$`));
  await expect(page.getByText(/^Last modified/)).toBeVisible();
});

test("reaches a note in a shared drive", async ({ page }) => {
  await page.goto("/shared-drives");
  await expect(heading(page, "Shared drives")).toBeVisible();
  await loaded(page);
  const listed = page.getByRole("link", { name: SHARED_DRIVE, exact: true });
  test.skip((await listed.count()) === 0, `needs the ${SHARED_DRIVE} drive`);
  await listed.click();
  await page.getByRole("link", { name: FROM_ANOTHER }).click();
  await expect(heading(page, FROM_ANOTHER)).toBeVisible();
});

test("finds the vault on Home, and warns before renaming a note in it", async ({
  page,
}) => {
  test.setTimeout(INDEX_TEST_TIMEOUT_MS);
  const vault = page
    .getByRole("region", { name: "Vaults" })
    .getByRole("link", { name: `${RUN} Vault` });
  // Drive's search, which finds vaults, can take a while to see a new one.
  await expect(async () => {
    await openHome(page);
    await expect(vault).toBeVisible({ timeout: 1_000 });
  }).toPass(INDEX);
  await vault.click();
  await page
    .getByRole("link", { name: `${RUN} daily.md` })
    .first()
    .click();
  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await expect(
    rename.getByText(/^This note is in an Obsidian vault\./),
  ).toBeVisible({ timeout: 30_000 });
  await rename.getByRole("button", { name: "Cancel" }).click();
});

test("creates, renames, moves and trashes a note", async ({ page, run }) => {
  await openRunFolder(page, run);

  await page.getByRole("button", { name: "New" }).click();
  const create = page.getByRole("dialog", { name: "New Markdown file" });
  await create.getByRole("textbox", { name: "Name" }).fill(`${RUN} idea`);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(heading(page, `${RUN} idea.md`)).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id") ?? "";

  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await rename.getByRole("textbox", { name: "Name" }).fill(`${RUN} plan.md`);
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(heading(page, `${RUN} plan.md`)).toBeVisible();

  await page.getByRole("button", { name: "Move", exact: true }).click();
  const move = page.getByRole("dialog", { name: `Move ${RUN} plan.md` });
  await move.getByRole("button", { name: `${RUN} Archive` }).click();
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(move).toHaveCount(0);
  await expect(crumbs(page)).toHaveText([
    "Home",
    "My Drive",
    run.name,
    `${RUN} Archive`,
  ]);

  await page.getByRole("button", { name: "Move to trash" }).click();
  await page
    .getByRole("dialog", { name: "Move to trash?" })
    .getByRole("button", { name: "Move to trash" })
    .click();
  await expect(heading(page, `${RUN} Archive`)).toBeVisible();
  await loaded(page);

  // Drive agrees with what the pages showed.
  const file = await run.drive.getMetadata({ id });
  expect(file.name).toBe(`${RUN} plan.md`);
  expect(file.parents).toEqual([run.ids.archive]);
  expect(file.trashed).toBe(true);
});
