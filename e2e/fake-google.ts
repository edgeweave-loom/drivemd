import { test as base, expect, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";

// Made-up data only: no real account, Drive ID or note.
export const EMAIL = "ada@example.com";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const SCOPE =
  "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.install";

/**
 * Google's sign-in script, as far as the app uses it: a token request made
 * within a tap gets a new token at once, as the popup would once the user
 * picked the account; one made without a tap fails, as browsers block the
 * popup then.
 */
const FAKE_GIS = `
let issued = 0;
window.google = { accounts: { oauth2: { initTokenClient: (config) => ({
  requestAccessToken: () => {
    if (!navigator.userActivation.isActive) {
      setTimeout(() => config.error_callback({ type: "popup_failed_to_open" }));
      return;
    }
    issued += 1;
    setTimeout(() => config.callback({
      access_token: "e2e-token-" + issued,
      expires_in: 3600,
      scope: ${JSON.stringify(SCOPE)},
    }), 20);
  },
}) } } };
`;

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  driveId?: string;
  target?: { id: string; mimeType: string };
  trashed?: boolean;
  sharedWithMe?: boolean;
  ownedByMe?: boolean;
  viewedByMeTime?: string;
  canAddChildren?: boolean;
  /** What a file holds, empty unless set. */
  content?: string | Buffer;
  /** How many times it was saved, from 1. */
  revision?: number;
}

/** A small Drive: My Drive, a vault, shortcuts, a shared drive, a share. */
function seed(): FakeFile[] {
  const markdown = "text/markdown";
  return [
    { id: "my-root", name: "My Drive", mimeType: FOLDER, parents: [] },
    { id: "work", name: "Work", mimeType: FOLDER, parents: ["my-root"] },
    { id: "archive", name: "Archive", mimeType: FOLDER, parents: ["work"] },
    {
      id: "plan",
      name: "plan.md",
      mimeType: markdown,
      parents: ["work"],
      viewedByMeTime: "2026-09-20T10:00:00.000Z",
      content: [
        "---",
        "owner: Ada",
        "tags: [tea, cups]",
        "---",
        "# The plan",
        "",
        "| Step | Owner |",
        "| ---- | ----- |",
        "| Tea  | Ada   |",
        "",
        "- [ ] Boil water",
        "- [x] Find cups",
        "",
        "```ts",
        "const cups = 2;",
        "```",
        "",
        "See [the docs](https://example.com/docs) and ![a chart](https://example.com/chart.png).",
        "",
        "Tea &amp; cups &copy; Ada&nbsp;Lovelace.",
        "",
        "Next: [the notes](notes.md#later), [the archive](Archive/), [a photo](photo.png) and [nothing](gone.md).",
        "",
        "![The photo](photo.png)",
        "",
        "<details><summary>More</summary>",
        "",
        '<b onclick="alert(1)">Bold</b> <script>alert(1)</script> <!-- hidden -->',
        "",
        "</details>",
        "",
      ].join("\n"),
    },
    {
      id: "notes",
      name: "notes.md",
      mimeType: markdown,
      parents: ["work"],
      // Long enough that its last heading starts off the screen.
      content: [
        "# Notes",
        ...Array.from({ length: 60 }, (_, line) => `\nLine ${String(line)}.`),
        "\n## Later",
        // And after it, so that it can scroll to the top of the screen.
        ...Array.from({ length: 60 }, (_, line) => `\nLater ${String(line)}.`),
        "",
      ].join("\n"),
    },
    {
      id: "photo",
      name: "photo.png",
      mimeType: "image/png",
      parents: ["work"],
      // A made-up picture of one pixel.
      content: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    },
    { id: "journal", name: "Journal", mimeType: FOLDER, parents: ["my-root"] },
    {
      id: "obsidian",
      name: ".obsidian",
      mimeType: FOLDER,
      parents: ["journal"],
    },
    {
      id: "app-settings",
      name: "app.json",
      mimeType: "application/json",
      parents: ["obsidian"],
      content: '{"alwaysUpdateLinks": true}',
    },
    { id: "how-to", name: "How to", mimeType: FOLDER, parents: ["journal"] },
    {
      id: "guide",
      name: "Guide.md",
      mimeType: markdown,
      parents: ["how-to"],
      // Long enough that its last heading starts off the screen.
      content: [
        "# Guide",
        ...Array.from({ length: 60 }, (_, line) => `\nStep ${String(line)}.`),
        "\n## Brewing",
        "\nWait.",
        "",
      ].join("\n"),
    },
    {
      id: "today",
      name: "today.md",
      mimeType: markdown,
      parents: ["journal"],
      content: [
        "Woke up early.",
        "Made tea.",
        "",
        "==Green tea== for #morning %%not shown%%done.^[From Japan.] ^tea",
        "",
        "Read [[guide#Brewing|the guide]] and [[Nowhere]].",
        "",
        "> [!tip]- Brew it hot",
        "> Water at 90 °C.",
        "",
      ].join("\n"),
    },
    {
      id: "to-plan",
      name: "Plan shortcut.md",
      mimeType: SHORTCUT,
      parents: ["my-root"],
      target: { id: "plan", mimeType: markdown },
      ownedByMe: true,
    },
    {
      id: "to-gone",
      name: "Gone",
      mimeType: SHORTCUT,
      parents: ["my-root"],
      target: { id: "deleted", mimeType: FOLDER },
      ownedByMe: true,
    },
    {
      id: "team",
      name: "Team",
      mimeType: FOLDER,
      parents: [],
      driveId: "team",
    },
    {
      id: "specs",
      name: "specs.md",
      mimeType: markdown,
      parents: ["team"],
      driveId: "team",
    },
    {
      id: "shared",
      name: "Shared notes",
      mimeType: FOLDER,
      parents: ["someone-elses"],
      sharedWithMe: true,
    },
    {
      id: "shared-note",
      name: "shared.md",
      mimeType: markdown,
      parents: ["shared"],
    },
  ].map((file) => ({ canAddChildren: file.mimeType === FOLDER, ...file }));
}

/** The Drive REST API over the made-up files, as the app calls it. */
export class FakeDrive {
  readonly files = new Map(seed().map((file) => [file.id, file]));
  /** Every write the app made, as method and path. */
  readonly writes: string[] = [];
  /** Calls the fake does not answer, which fail the test. */
  readonly unanswered: string[] = [];
  private refused = new Set<string>();
  private lastToken = "";
  private created = 0;

  /** Makes Drive refuse the token the app holds, as when it expired. */
  expireToken(): void {
    this.refused.add(this.lastToken);
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const token = (request.headers().authorization ?? "").replace(
      /^Bearer /,
      "",
    );
    this.lastToken = token;
    if (token === "" || this.refused.has(token)) {
      await reply(route, 401, { error: { message: "Invalid Credentials" } });
      return;
    }
    const url = new URL(request.url());
    if (url.searchParams.get("alt") === "media") {
      await this.send(route, url.pathname);
      return;
    }
    const upload = /^\/upload\/drive\/v3\/files\/([\w-]+)$/.exec(url.pathname);
    if (upload && request.method() === "PATCH") {
      await reply(
        route,
        ...this.save(upload[1] ?? "", request.postDataBuffer()),
      );
      return;
    }
    const answer =
      url.pathname.startsWith("/drive/v3/") && !url.searchParams.has("alt")
        ? this.answer(
            request.method(),
            url.pathname.replace("/drive/v3", ""),
            url.searchParams,
            request.postData(),
          )
        : undefined;
    if (!answer) {
      this.unanswered.push(`${request.method()} ${url.pathname}`);
      await reply(route, 501, { error: { message: "Not faked" } });
      return;
    }
    await reply(route, ...answer);
  }

  /** A file's bytes, as Drive sends them. */
  private async send(route: Route, path: string): Promise<void> {
    const id = /^\/drive\/v3\/files\/([\w-]+)$/.exec(path)?.[1];
    const file = id === undefined ? undefined : this.files.get(id);
    if (!file) {
      await reply(route, 404, {
        error: { message: `File not found: ${path}.` },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": file.mimeType },
      body: file.content ?? "",
    });
  }

  /** Replaces a file's bytes, as an upload of type media does. */
  private save(id: string, bytes: Buffer | null): [number, unknown] {
    const file = this.files.get(id);
    if (!file) return [404, { error: { message: `File not found: ${id}.` } }];
    file.content = bytes ?? Buffer.alloc(0);
    file.revision = (file.revision ?? 1) + 1;
    this.writes.push(`save ${id}`);
    return [200, asJson(file)];
  }

  private answer(
    method: string,
    path: string,
    params: URLSearchParams,
    data: string | null,
  ): [number, unknown] | undefined {
    if (path === "/about") return [200, { user: { emailAddress: EMAIL } }];
    if (path === "/drives") {
      return [200, { drives: [{ id: "team", name: "Team" }] }];
    }
    if (path === "/files" && method === "GET") {
      return [200, { files: this.search(params.get("q") ?? "").map(asJson) }];
    }
    if (path === "/files" && method === "POST") {
      const { name, parents } = JSON.parse(data ?? "{}") as FakeFile;
      this.created += 1;
      const file = {
        id: `created-${String(this.created)}`,
        name,
        mimeType: "text/markdown",
        parents,
      };
      this.files.set(file.id, file);
      this.writes.push(`create ${name}`);
      return [200, asJson(file)];
    }
    const kept = /^\/files\/([\w-]+)\/revisions\/([\w-]+)$/.exec(path);
    if (kept && method === "PATCH") {
      this.writes.push(`keep ${kept[1] ?? ""} ${kept[2] ?? ""}`);
      return [200, { id: kept[2] }];
    }
    const id = /^\/files\/([\w-]+)$/.exec(path)?.[1];
    if (id === undefined) return;
    const file = this.files.get(id === "root" ? "my-root" : id);
    if (!file) return [404, { error: { message: `File not found: ${path}.` } }];
    if (method === "PATCH") this.change(file, params, data);
    return [200, asJson(file)];
  }

  private change(
    file: FakeFile,
    params: URLSearchParams,
    data: string | null,
  ): void {
    const changes = JSON.parse(data ?? "{}") as Partial<FakeFile>;
    if (changes.name !== undefined) {
      file.name = changes.name;
      this.writes.push(`rename ${file.id} ${changes.name}`);
    }
    if (changes.trashed) {
      file.trashed = true;
      this.writes.push(`trash ${file.id}`);
    }
    if (changes.viewedByMeTime) file.viewedByMeTime = changes.viewedByMeTime;
    const to = params.get("addParents");
    if (to) {
      file.parents = [to];
      this.writes.push(`move ${file.id} ${to}`);
    }
  }

  /** The files matching the query shapes src/drive.ts builds. */
  private search(q: string): FakeFile[] {
    const all = [...this.files.values()].filter((file) => !file.trashed);
    const parent = /^'([\w-]+)' in parents and/.exec(q)?.[1];
    if (parent) {
      // As in Drive, "root" names My Drive's top folder.
      const id = parent === "root" ? "my-root" : parent;
      return all.filter((file) => file.parents.includes(id));
    }
    if (q.startsWith("sharedWithMe")) {
      return all.filter((file) => file.sharedWithMe);
    }
    if (q.includes("'me' in owners")) {
      return all.filter((file) => file.ownedByMe && file.mimeType === SHORTCUT);
    }
    if (q.startsWith("viewedByMeTime")) {
      return all
        .filter((file) => file.viewedByMeTime)
        .sort((a, b) =>
          (b.viewedByMeTime ?? "").localeCompare(a.viewedByMeTime ?? ""),
        );
    }
    if (q.startsWith("name = '.obsidian'")) {
      return all.filter((file) => file.name === ".obsidian");
    }
    // The folders in several folders, as listFolders asks.
    const several =
      /^\(((?:'[\w-]+' in parents(?: or )?)+)\) and mimeType/.exec(q)?.[1];
    if (several !== undefined) {
      const ids = [...several.matchAll(/'([\w-]+)'/g)].map(([, id]) =>
        id === "root" ? "my-root" : id,
      );
      return all.filter(
        (file) =>
          file.mimeType === FOLDER &&
          file.parents.some((parent) => ids.includes(parent)),
      );
    }
    // Drive matches an exact name whatever the case of its ASCII letters.
    const names = [...q.matchAll(/name = '((?:[^'\\]|\\.)*)'/g)].map(
      ([, name = ""]) => name.replace(/\\(.)/g, "$1").toLowerCase(),
    );
    if (names.length > 0 && !q.startsWith("name = '.obsidian'")) {
      return all.filter(
        (file) =>
          names.includes(file.name.toLowerCase()) &&
          !file.mimeType.startsWith("application/vnd.google-apps."),
      );
    }
    // Drive escapes quotes and backslashes in its string literals.
    const words = [...q.matchAll(/name contains '((?:[^'\\]|\\.)*)'/g)].map(
      ([, word]) => (word ?? "").replace(/\\(.)/g, "$1").toLowerCase(),
    );
    const withContent = q.includes(
      "not mimeType contains 'application/vnd.google-apps.'",
    );
    return all.filter(
      (file) =>
        !(
          withContent &&
          file.mimeType.startsWith("application/vnd.google-apps.")
        ) &&
        words.every((word) =>
          file.name
            .toLowerCase()
            .split(/[\s._-]+/)
            .some((part) => part.startsWith(word)),
        ),
    );
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, content-type, x-goog-drive-resource-keys",
  "access-control-allow-methods": "GET, POST, PATCH",
};

async function reply(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, headers: CORS, json: body });
}

function asJson(file: FakeFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    driveId: file.driveId,
    trashed: file.trashed ?? false,
    shortcutDetails: file.target && {
      targetId: file.target.id,
      targetMimeType: file.target.mimeType,
    },
    capabilities: {
      canAddChildren: file.canAddChildren ?? false,
      canDownload: true,
      canEdit: true,
      canModifyContent: true,
      canMoveItemOutOfDrive: true,
      canMoveItemWithinDrive: true,
      canRename: true,
      canTrash: true,
    },
    modifiedTime: "2026-09-01T10:00:00.000Z",
    lastModifyingUser: { displayName: "Ada Lovelace" },
    md5Checksum: createHash("md5")
      .update(file.content ?? "")
      .digest("hex"),
    headRevisionId: `revision-${String(file.revision ?? 1)}`,
    size: String(Buffer.from(file.content ?? "").length),
  };
}

declare global {
  interface Window {
    reportViolation?: (violation: string) => Promise<void>;
  }
}

/**
 * Tests on the built app, served with Hosting's headers, against the made-up
 * Google above. Each test fails on a page error, on anything the security
 * policy blocks, on a Drive call the fake does not answer, and on any request
 * that would leave the app for the network.
 */
export const test = base.extend<{ drive: FakeDrive }>({
  drive: [
    async ({ page, baseURL }, use) => {
      const drive = new FakeDrive();
      const problems: string[] = [];
      // Routes added later come first: this one catches what the others don't.
      await page.route("**", (route) => {
        const url = route.request().url();
        // WebKit routes the object URLs the app makes for Drive's images too.
        const app = baseURL && new URL(baseURL).origin;
        if (
          app &&
          (url.startsWith(`${app}/`) || url.startsWith(`blob:${app}/`))
        ) {
          return route.fallback();
        }
        problems.push(`request to ${url}`);
        return route.abort();
      });
      await page.route("https://accounts.google.com/gsi/client", (route) =>
        route.fulfill({ contentType: "text/javascript", body: FAKE_GIS }),
      );
      await page.route("https://www.googleapis.com/**", (route) =>
        drive.handle(route),
      );
      page.on("pageerror", (error) => problems.push(error.message));
      // Collected here, since every page the test opens starts afresh.
      await page.exposeFunction("reportViolation", (violation: string) => {
        problems.push(`blocked: ${violation}`);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          void window.reportViolation?.(
            `${event.effectiveDirective} ${event.blockedURI}`,
          );
        });
      });
      await use(drive);
      expect(problems).toEqual([]);
      expect(drive.unanswered).toEqual([]);
    },
    // Every test runs against the made-up Google, whether it reads it or not.
    { auto: true },
  ],
});

export { expect };

/**
 * Opens the app and signs in, landing on Home once it has loaded: leaving a
 * page while Drive answers cancels the call, which WebKit reports as an error.
 */
export async function signIn(page: Page): Promise<void> {
  const response = await page.goto("/");
  // The tests run under the security policy that production sends.
  expect(response?.headers()["content-security-policy"]).toContain(
    "require-trusted-types-for 'script'",
  );
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recent" }).getByRole("link"),
  ).toHaveText(["plan.md"]);
  await expect(
    page.getByRole("region", { name: "Vaults" }).getByRole("link"),
  ).toHaveText(["Journal"]);
}
