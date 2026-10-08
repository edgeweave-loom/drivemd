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
// A first save checks the revision, keeps the one before the edits, then
// writes: three calls to Drive in turn, which can take longer than the 5 s
// Playwright waits by default.
const SAVE = { timeout: 20_000 };

interface Run {
  /** The run's folder, named after the browser, which makes its own. */
  name: string;
  account: string;
  auth: DriveAuth;
  drive: Drive;
  /** The IDs of what the run made, by role. */
  ids: Record<
    "folder" | "notes" | "note" | "archive" | "vault" | "obsidian" | "guide",
    string
  >;
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

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Makes a folder, a note, a shortcut to it, a vault and notes in it. */
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
  const config = await api.make({
    name: ".obsidian",
    mimeType: FOLDER,
    parents: [vault],
  });
  await drive.createFile({ id: vault }, `${RUN} daily`);
  const { guide, obsidian } = await fillVault(api, drive, vault, config);
  await api.make({
    name: `${RUN} Linked note.md`,
    mimeType: SHORTCUT,
    shortcutDetails: { targetId: note },
    ...inRun,
  });
  return { folder, notes, note, archive, vault, obsidian, guide };
}

/** A made-up picture of one pixel. */
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

/**
 * Writes a vault as Obsidian would: its settings, a guide and a picture in a
 * folder of its own, and a note at its top that links to them and embeds
 * them, with Obsidian's syntax.
 */
async function fillVault(
  api: ReturnType<typeof driveApi>,
  drive: Drive,
  vault: string,
  config: string,
) {
  const put = async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
    await drive.saveContent(await drive.getMetadata({ id }), bytes);
  };
  const settings = await api.make({
    name: "app.json",
    mimeType: "application/json",
    parents: [config],
  });
  await put(settings, utf8("{}"));
  const guides = await api.make({
    name: `${RUN} Guides`,
    mimeType: FOLDER,
    parents: [vault],
  });
  const guide = (await drive.createFile({ id: guides }, `${RUN} Guide`)).id;
  const filler = Array.from(
    { length: 60 },
    (_, line) => `Step ${String(line)}.`,
  );
  await put(
    guide,
    utf8(["# Guide", ...filler, "## Brewing", "Wait.", ...filler].join("\n\n")),
  );
  const pixel = await api.make({
    name: `${RUN} pixel.png`,
    mimeType: "image/png",
    parents: [guides],
  });
  await put(pixel, PIXEL);
  const obsidian = (await drive.createFile({ id: vault }, `${RUN} obsidian`))
    .id;
  await put(
    obsidian,
    utf8(
      [
        "Line one",
        "Line two",
        "",
        "> [!tip]- Folded",
        "> Hidden body",
        "",
        "==Lit== #live-tag %%secret%%",
        "",
        `Go to [[${RUN} Guide#Brewing|the guide]] and [[${RUN} Missing]].`,
        "",
        `![[${RUN} Guide#Brewing]]`,
        "",
        `![[${RUN} pixel.png|40]]`,
        "",
      ].join("\n"),
    ),
  );
  return { guide, obsidian };
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { level: 2, name, exact: true });
}

/** A note's name, which its app bar gives. */
function noteName(page: Page, name: string) {
  return page
    .getByRole("banner")
    .getByRole("heading", { level: 1, name, exact: true });
}

function crumbs(page: Page) {
  return page
    .getByRole("navigation", { name: "Breadcrumbs" })
    .getByRole("link");
}

function phone() {
  return test.info().project.metadata.layout === "phone";
}

/**
 * The link from a note to the folder it sits in: heading the folder pane on
 * a wide screen, or Back on a phone.
 */
function folderLink(page: Page, name: string) {
  return phone()
    ? page.getByRole("banner").getByRole("link", { name: `Back to ${name}` })
    : page
        .getByRole("complementary", { name })
        .getByRole("link", { name, exact: true });
}

/**
 * Picks one of a note's actions: Move by the note's name, but on a phone,
 * and the others from More actions.
 */
async function noteAction(page: Page, name: "Move" | "Move to trash") {
  const bar = page.getByRole("banner");
  if (name === "Move" && !phone()) {
    await bar.getByRole("button", { name, exact: true }).click();
    return;
  }
  await bar.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("dialog", { name: "More actions" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** Renames a note by its name in the app bar, as a click on it does. */
async function renameNote(page: Page, from: string, to: string) {
  await page.getByRole("banner").getByRole("button", { name: from }).click();
  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill(to);
  await name.press("Enter");
}

/** The search box, opened first where a phone keeps it behind a button. */
async function searchBox(page: Page) {
  if (phone()) {
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }
  return page.getByRole("searchbox", { name: "Search Markdown files by name" });
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
  await page.getByRole("link", { name: "My Drive", exact: true }).click();
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
  await expect(noteName(page, `${RUN} note.md`)).toBeVisible();
  // Under its name, but on a phone.
  await expect(page.getByText(/^Last modified/)).toBeAttached();
  await expect(folderLink(page, `${RUN} Notes`)).toBeVisible();
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
  await expect(page.getByText(/^Last modified/)).toBeAttached();
});

test("reaches a note in a shared drive", async ({ page }) => {
  await page.goto("/shared-drives");
  await expect(heading(page, "Shared drives")).toBeVisible();
  await loaded(page);
  const listed = page.getByRole("link", { name: SHARED_DRIVE, exact: true });
  test.skip((await listed.count()) === 0, `needs the ${SHARED_DRIVE} drive`);
  await listed.click();
  await page.getByRole("link", { name: FROM_ANOTHER }).click();
  await expect(noteName(page, FROM_ANOTHER)).toBeVisible();
});

test("finds the vault on Home, and warns before renaming a note in it", async ({
  page,
}) => {
  test.setTimeout(INDEX_TEST_TIMEOUT_MS);
  // On Home on a phone, or in the drawer beside it on a wide screen.
  const vault = page
    .getByRole("region", { name: "Vaults" })
    .or(page.getByRole("navigation", { name: "Drive" }))
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
  // Inside a vault, renaming asks first.
  await renameNote(page, `${RUN} daily.md`, `${RUN} weekly`);
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
  await expect(noteName(page, `${RUN} idea.md`)).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id") ?? "";
  // Once the note shows, as a person would rename it: before the vault check
  // has answered, renaming asks first.
  await loaded(page);

  await renameNote(page, `${RUN} idea.md`, `${RUN} plan`);
  await expect(noteName(page, `${RUN} plan.md`)).toBeVisible();

  await noteAction(page, "Move");
  const move = page.getByRole("dialog", { name: `Move ${RUN} plan.md` });
  await move.getByRole("button", { name: `${RUN} Archive` }).click();
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(move).toHaveCount(0);
  await expect(folderLink(page, `${RUN} Archive`)).toBeVisible();

  await noteAction(page, "Move to trash");
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

/** Drive's Open with or New address, as Drive opens it. */
function fromDrive(path: "/open" | "/new", state: Record<string, unknown>) {
  // A made-up profile ID: a tab that has a token acts as its own account.
  const userId = "104857600000000000001";
  const query = new URLSearchParams({
    state: JSON.stringify({ ...state, userId }),
  });
  return `${path}?${query.toString()}`;
}

test("opens what Drive's Open with, New and pasted links name", async ({
  page,
  run,
}) => {
  await page.goto(
    fromDrive("/open", {
      ids: [run.ids.note],
      resourceKeys: {},
      action: "open",
    }),
  );
  await expect(page).toHaveURL(new RegExp(`/edit\\?id=${run.ids.note}$`));
  await expect(noteName(page, `${RUN} note.md`)).toBeVisible();
  // The tab holds the note alone: its mark leads nowhere, and no folder or
  // way up shows.
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("img", { name: "DriveMD" })).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  // Editing on a computer, reading on a phone.
  await expect(
    phone()
      ? page.getByRole("button", { name: "Edit", exact: true })
      : bar.getByRole("button", { name: "Editing" }),
  ).toBeVisible();
  await loaded(page);

  // An address typed in the tab ends that; a note's bar holds no search,
  // which Home's does.
  await openHome(page);
  const search = await searchBox(page);
  await search.fill(
    `https://drive.google.com/drive/folders/${run.ids.notes}?usp=sharing`,
  );
  await search.press("Enter");
  await expect(heading(page, `${RUN} Notes`)).toBeVisible();
  await expect(crumbs(page)).toHaveText(["Home", "My Drive", run.name]);
  await loaded(page);

  await page.goto(
    fromDrive("/new", { action: "create", folderId: run.ids.notes }),
  );
  const create = page.getByRole("dialog", { name: "New Markdown file" });
  await create.getByRole("textbox", { name: "Name" }).fill(`${RUN} from Drive`);
  await create.getByRole("button", { name: "Create" }).click();
  await expect(noteName(page, `${RUN} from Drive.md`)).toBeVisible();
  await loaded(page);
  const id = new URL(page.url()).searchParams.get("id") ?? "";

  // Drive agrees with what the pages showed.
  const file = await run.drive.getMetadata({ id });
  expect(file.name).toBe(`${RUN} from Drive.md`);
  expect(file.parents).toEqual([run.ids.notes]);
});

/** A note another tool wrote in the run's notes folder, with these bytes. */
async function written(
  run: Run,
  name: string,
  content: Uint8Array<ArrayBuffer>,
) {
  const made = await run.drive.createFile(
    { id: run.ids.notes },
    `${RUN} ${name}`,
  );
  await run.drive.saveContent(await run.drive.getMetadata(made), content);
  return made.id;
}

async function bytesOf(run: Run, id: string) {
  return run.drive.getContent(await run.drive.getMetadata({ id }), 1_000_000);
}

test("checks a task in a CRLF note with a byte order mark, saving that byte only", async ({
  page,
  run,
}) => {
  const before = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...utf8("# Tea\r\n\r\n- [ ] Boil\r\n- [ ] Pour\r\n"),
  ]);
  const id = await written(run, "crlf", before);
  await page.goto(`/edit?id=${id}`);
  const note = page.locator(".markdown");
  await expect(note.getByRole("checkbox")).toHaveCount(2);
  await loaded(page);

  // Ticked while viewing, a task saves at once.
  await note.getByRole("checkbox").last().check();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible(SAVE);

  const after = before.slice();
  // The space between the brackets of "- [ ] Pour\r\n", 9 bytes from the end.
  after[after.length - 9] = 0x78;
  expect(await bytesOf(run, id)).toEqual(after);
});

test("edits a note's source and saves it, keeping its line breaks", async ({
  page,
  run,
}) => {
  const id = await written(run, "edited", utf8("# Tea\r\n\r\nGreen.\r\n"));
  await page.goto(`/edit?id=${id}`);
  await expect(page.locator(".markdown").getByText("Green.")).toBeVisible();
  await loaded(page);

  if (phone()) {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Viewing" }).click();
    await page
      .getByRole("menu", { name: "Mode" })
      .getByRole("menuitemradio", { name: "Editing" })
      .click();
  }
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Black.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible(SAVE);

  expect(await bytesOf(run, id)).toEqual(utf8("# Tea\r\n\r\nGreen.\r\nBlack."));
});

test("shows a note that is not UTF-8 read-only", async ({ page, run }) => {
  const id = await written(
    run,
    "latin1",
    new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
  );
  await page.goto(`/edit?id=${id}`);

  await expect(
    page.getByText("Not UTF-8 text: DriveMD only shows it"),
  ).toBeVisible();
  await loaded(page);
  await expect(
    page.getByRole("button", { name: /^(Edit|Viewing)$/ }),
  ).toHaveCount(0);
});

test("renders a note of a vault as Obsidian does, its links and embeds leading to the right files", async ({
  page,
  run,
}) => {
  test.setTimeout(INDEX_TEST_TIMEOUT_MS);
  // Drive's search finds the guide by name before the note looks for it.
  await expect
    .poll(
      async () =>
        (await run.drive.findByName(`${RUN} Guide.md`)).items.map(
          ({ id }) => id,
        ),
      INDEX,
    )
    .toContain(run.ids.guide);
  await page.goto(`/edit?id=${run.ids.obsidian}`);

  const note = page.locator(".markdown").first();
  await expect(note.locator("p br").first()).toBeAttached();
  await expect(note.locator(".callout")).toHaveAttribute("data-callout", "tip");
  await expect(note.locator("mark")).toHaveText("Lit");
  await expect(note.locator(".tag")).toHaveText("#live-tag");
  await expect(note).not.toContainText("secret");
  const link = note.getByRole("link", { name: "the guide" });
  await expect(link).toHaveAttribute(
    "href",
    `/edit?id=${run.ids.guide}#brewing`,
  );
  await expect(note.getByText(`${RUN} Missing`)).toHaveClass("unresolved");
  await expect(note.locator(".embed").getByText("Wait.")).toBeVisible();
  const pixel = note.getByRole("img", { name: `${RUN} pixel.png` });
  await expect(pixel).toHaveAttribute("width", "40");
  await expect
    .poll(() => pixel.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  await loaded(page);

  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/edit\\?id=${run.ids.guide}#brewing$`),
  );
  await expect(
    page.locator(".markdown").getByRole("heading", { name: "Brewing" }),
  ).toBeInViewport();
  await loaded(page);
});
