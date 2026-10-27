# Developing DriveMD

How to build, test and release DriveMD. [`SPEC.md`](SPEC.md) says what the app does and why, [`DESIGN.md`](DESIGN.md) how it looks, and [`CONTRIBUTING.md`](../CONTRIBUTING.md) how to propose a change. To run a copy for your organization, see [`self-hosting.md`](self-hosting.md).

## Setup

You need [pnpm](https://pnpm.io/installation). It switches to the version that `packageManager` names in `package.json`, and installs the Node.js that `devEngines` pins there to run the scripts.

```sh
pnpm install
pnpm run dev
```

Open http://localhost:5173, not `127.0.0.1`: it is the only local origin the OAuth client authorizes, so the dev server refuses to start on another port. Signing in needs an OAuth client's ID, in `.env.local` as [Configuration](self-hosting.md#configuration) says, but the tests do not: they replace Google with made-up answers.

Once per clone, `git config core.hooksPath .githooks` turns on the repository's Git hooks: before each commit, Prettier and ESLint check the files being committed; before each push, `pnpm run check` runs.

## Commands

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `pnpm run dev`              | Serve the app with hot reload                                    |
| `pnpm run build`            | Type-check, then build the static site into `dist/`              |
| `pnpm run preview`          | Serve the `dist/` build on the same port                         |
| `pnpm test`                 | Run the tests in watch mode                                      |
| `pnpm run coverage`         | Run the tests once; fails under the coverage thresholds          |
| `pnpm run e2e`              | Run the end-to-end tests in real browsers                        |
| `pnpm run lint`             | Lint with type-aware and security rules; any warning fails       |
| `pnpm run format`           | Format every file with Prettier (`pnpm run format:check` checks) |
| `pnpm run check`            | Lint, check the format, run `coverage`, then `build`, as CI does |
| `pnpm run deploy`           | Deploy `dist/` to the site mapped to the `app` target            |
| `pnpm run live-check:login` | Sign the test account in for the live Drive checks               |
| `pnpm run live-check`       | Check the Drive client against the real Drive                    |
| `pnpm run live-check:ui`    | Check the deployed app on the real Drive, in real browsers       |

Write the failing test first, then the code that makes it pass. CI runs the checks above on every pull request and on every push to `dev` and `main`.

## End-to-end tests

`pnpm run e2e` builds the app and serves it with the headers Firebase Hosting sends, its security policy included. It then drives the app with Playwright in Chromium, as a desktop, and in WebKit, as an iPad and an iPhone held upright and sideways. Google's sign-in script and the Drive API are replaced by made-up ones (`e2e/fake-google.ts`), so the tests need no account and never reach Google. A test fails on any page error and on anything the security policy blocks.

Before the first run, download the browsers once with `pnpm exec playwright install chromium webkit`: they go to `~/.cache/ms-playwright`, shared by every project on the machine. WebKit also needs system libraries, which `pnpm exec playwright install-deps webkit` installs, asking for `sudo`. CI runs the tests in Microsoft's Playwright image, which holds both, and deploys only once they pass. The image's version must be the locked `@playwright/test`'s, as CI checks, and Dependabot does not update it: its Playwright pull request fails until you set, on the same branch, the image's tag in `.github/workflows/ci.yml` with the digest that `docker buildx imagetools inspect mcr.microsoft.com/playwright:v<version>-noble` prints. The tests record no traces, screenshots or videos, which would keep the requests the app makes.

## Live Drive checks

The unit tests replace Google Drive with mocked answers, so a few behaviors can only be checked against the real Drive. The live checks do it as a test account of your organization, never with a person's account: its Drive holds nothing but what the checks create, a made-up file `drivemd-live-view-only.md` that another account shares with it as a viewer, and a shared drive named `DriveMD live check` where it is a content manager, holding a made-up file `drivemd-live-from-another.md` that another member added. Nothing about the account enters the repository. Its credentials stay in `~/.config/drivemd-live/`, or in the absolute path set in `DRIVEMD_LIVE_DIR`: the desktop OAuth client as `client.json` and the account's grant as `grant.json`. The scripts read them only when they are yours and nobody else can read them, and check with Drive that the grant belongs to the account it names before they act.

To set up, once:

1. Create an OAuth client of type **Desktop app** in the Google Cloud project, download its JSON, and save it as `client.json` in that folder, then `chmod 700` the folder and `chmod 600` the file.
2. In your own terminal, since it asks you to paste an address, run `DRIVEMD_LIVE_ACCOUNT=<test account> pnpm run live-check:login`. Open the address it prints, sign in as the test account and allow access; the browser then fails to load `127.0.0.1`, and you paste its address back. The script keeps the grant only if the test account signed in, and revokes any grant it cannot keep or that it replaces; it saves the grant as `grant.json`, readable only by you.

Then `pnpm run live-check` runs the checks, which CI never does. Among them, notes written as another tool would, with CRLF and a byte order mark, LF or CR line breaks, are opened, decoded and saved with one task checked, and Drive must then hold the same bytes but that one; a note that is not UTF-8 must open read-only, and a save over someone else's change must write nothing. A file must also be found by its exact name, whatever its case, as Obsidian's links find notes, accented names included; and Drive must name no folder of a file shared alone that the account cannot reach. The shared drive's top folder, which Drive names "Drive", must come under the drive's own name, and so must a vault there, for which one check puts an `.obsidian` folder at the top of the shared drive, unless one is there, and trashes it after. The others make what they need in a folder of their own in the test account's Drive and trash it at the end, and they compare IDs rather than listings, so that no failure prints the names of other files. A check that needs one of the made-up files or the shared drive is skipped until it exists.

`pnpm run live-check:ui` checks the deployed app the same way, in Chromium as a desktop and WebKit as an iPhone: staging by default, or the address in `DRIVEMD_LIVE_URL`. It hands the page the test account's session as a sign-in would leave it, so Google's window never opens; it then reaches notes in My Drive, a shared drive, a vault and behind a shortcut, finds one on Home and by search, and creates, renames, moves and trashes one, in a folder of its own that it trashes at the end. It also checks a task and edits a note's source in the deployed app, and finds Drive holding the bytes it should. It opens a note from Drive's **Open with** address, which the tab then holds alone, and a folder from a Drive link pasted in the search box, and creates a note from Drive's **New** address in the folder it names. Last, it opens a note of a vault written as Obsidian would, with a callout, a highlight, a tag, a comment, a link and embeds of a note's section and a picture, which must show and lead to the files they name. It fails on any page error and on anything the security policy blocks that the app depends on. It records no traces, screenshots or videos, which would keep the token.

## Device checks

Neither the end-to-end tests nor the live checks run iOS or Android themselves: the browser's bars, the on-screen keyboard, the notch and the home bar, the Home Screen app or the installed one, Android's Back and share sheet, and Google's sign-in window. [`apple-device-checks.md`](apple-device-checks.md) lists the checks for those, on staging, written for Claude Code driving the iOS Simulator on a Mac, and readable by a person with a real iPhone or iPad; [`android-device-checks.md`](android-device-checks.md) does the same with the Android Emulator, which needs Android Studio or its command-line tools. [`device-setup-apple.md`](device-setup-apple.md) and [`device-setup-android.md`](device-setup-android.md) say how to set up the Mac for each, and what to do when a tool fails. The MCP server that drives the Simulator and the emulator is declared in `.mcp.json`: Claude Code offers it to whoever opens the repository, and only those who run these checks need accept it. Run them before a milestone that changes the interface closes, and before a release.

## Supply chain and code safety

The app's access token can read and write the user's whole Drive, so the repository guards against injected code and a compromised supply chain:

- Strict TypeScript and type-aware ESLint, whose rules reject `eval` and unsanitized DOM sinks such as `innerHTML` and `dangerouslySetInnerHTML`.
- The Drive client sends the token only in the `Authorization` header, refuses an ID that is not shaped like a Drive ID before it reaches a URL or a query, escapes search text, and keeps Drive's answers out of the browser's HTTP cache.
- `firebase.json` serves a strict Content Security Policy that enforces Trusted Types and allows no images but the app's own and the object URLs it makes for images read from Drive, nor any inline style: the editor styles itself in a shadow root, through constructed style sheets, along with HSTS, isolation from other origins' windows and requests, and no MIME sniffing. `src/security-headers.test.ts` fails if any of them weakens.
- `pnpm-workspace.yaml` saves exact versions in `package.json`, refuses a dependency whose `engines` exclude the project's Node.js, installs only releases at least 7 days old, and refuses a release published with weaker evidence of where it comes from (provenance, trusted publisher) than an earlier one of the same package. It runs no dependency's install script, and an install fails on one it does not list: list it there, `false` unless the dependency cannot work without it, with the reason.
- CI installs from the lockfile with `pnpm install --frozen-lockfile`, which checks every locked version against those rules again, verifies registry signatures, blocks critical advisories in any dependency, and blocks any advisory in the dependencies that ship. GitHub's dependency graph does not read pnpm 12's lockfile yet ([dependabot-core#15904](https://github.com/dependabot/dependabot-core/issues/15904)), so Dependabot raises no security alert: these audits are the advisory check, and the Audit workflow also runs them every day on `dev`, between pushes.
- Dependabot proposes dependency and GitHub Actions updates weekly, for releases at least 7 days old. pnpm (`packageManager` in `package.json`) and Node.js (`devEngines`) follow the same rule, Node.js on an LTS line.
- Workflows pin every action to a commit SHA, start from no permissions and grant each job only what it needs; zizmor audits them in CI, and gitleaks scans the full history on every push and every pull request from a fork. The zizmor and gitleaks versions are pinned in the workflows and bumped by hand.
- On GitHub, secret scanning with push protection and CodeQL run on the repository, and `dev` and `main` are reached only through pull requests whose checks pass, and keep their history: neither can be deleted or force-pushed.

## Releases

Releases follow the spec's [Versions](SPEC.md#recommended-tech-stack): `package.json` on `dev` names the next one, and a pull request to `main` fails CI if that version is already tagged. Once production is deployed, the release job tags the merge commit `v<version>` and publishes a GitHub release with the merge commit's body as notes; a rerun on the same commit changes nothing. A release whose run never deployed, because a later push to `main` overtook it, gets no tag: create it by hand with `gh release create v<version> --target <merge commit>`. Right after a release, give `package.json` on `dev` the next version with `pnpm version <version> --no-git-tag-version`, in a pull request of its own.

The app shows its version in the account's menu: `0.8.0` in production, and `0.8.0-beta.12+abc1234` on staging or from a local build, where 12 counts the commits since the latest release before 0.8.0 and `abc1234` names the build's commit (the count is left out when git lacks that release's tag or commits). The build also writes it to `/version.json`, which an open page compares with its own to offer the new version.
