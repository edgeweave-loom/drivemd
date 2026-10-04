# DriveMD

Browse, view and edit the Markdown files in our Google Drive, on desktop and on phones (iPhone first, Android too), including notes in Obsidian vaults.

DriveMD is a static web app for our Google Workspace organization. It signs in with Google, calls the Drive API straight from the browser, and never rewrites a file it did not change.

## Status

Milestones 1 to 4 are done, and milestone 5, Obsidian vaults, is under way. The product spec, [`docs/SPEC.md`](docs/SPEC.md), is the source of truth, and its build plan drives the work one milestone at a time.

- **Milestone 1, sign-in.** The app signs in with Google and shows the signed-in account's email, CI deploys `dev` to staging, and sign-in passed the test on a real iPhone without a token backend.
- **Milestone 2, the Drive client.** `src/drive.ts` is the typed Drive client that the next milestones build on, tested against mocked Drive answers.
- **Milestone 3, the file navigator**, checked on the real Drive in real browsers and on a real iPhone. Once signed in, the app opens on Home, which shows the Markdown files opened last and the Obsidian vaults in Drive, and from which My Drive, Shortcuts, Shared drives and Shared with me open, then their folders one after the other, listing their folders and Markdown files and following shortcuts, and greying out those whose target is gone. Breadcrumbs show the path taken, or the one rebuilt from Drive for a page opened by its address, and a search box on every page finds Markdown files by name in every drive, saying when Drive left some drives out. **New** creates a Markdown file in a folder where the user may add files, asking for its name first, and a file's page can rename it or move it to another folder, warning first when it sits in an Obsidian vault, or move it to Drive's trash once the user confirms. On a wide screen, a file's page lists its folder beside it; on a tablet held upright, **Folder** opens that list in a drawer. Each page has its own address (see the spec's file navigator).
- **Milestone 4, the viewer and editor**, checked on the real Drive in real browsers and on a real iPhone: saving a note changes only the lines edited, a file with Windows line breaks or a byte order mark is written back byte for byte, and a file that is not UTF-8 opens read-only. A file opens on its own page, which says who changed it last and shows it rendered as GitHub renders Markdown, with tables, task lists, footnotes, highlighted code, sanitized HTML and front matter as a table of properties; a file over 1 MB, or one the user may not download, leads to Google Drive instead, and a badge says why a file is read-only. Relative links lead where their path does in Drive, from the note's folder: to a note or a folder in the app, to another file in Google Drive, and a link to nothing is faded. Relative images show from Drive, up to 10 MB; images on other sites are not loaded: each is a link that opens it in a new tab. **Edit** opens the note's source in CodeMirror, beside the preview on a wide screen or a tablet and in its place on a phone, with Markdown highlighting and front matter as YAML, lists continued on Enter, a search panel, and Cmd/Ctrl+click to follow a link. A tap on a task's checkbox, in the viewer or the preview, checks or unchecks it, and **Save**, or Cmd/Ctrl+S, writes the note back: only if its bytes changed, once Drive confirms nobody else changed it since (when someone did, the page shows the differences and lets the user keep Drive's version, overwrite it, or save theirs as a copy), and keeping the revision from before the first edit in the file's version history. Unsaved changes are kept on the device as the user types, and reopening the note offers them back; leaving a note with unsaved changes asks first.
- **Milestone 5, Obsidian vaults**, under way. A link to a note's heading, `plan.md#next-steps`, opens the note there. A note in an Obsidian vault shows as Obsidian shows it: a single line break shows as one, unless the vault's settings join lines as Markdown does, callouts show in their type's color, folded or open when they fold, highlights, tags and inline footnotes show, and comments and block IDs do not. Internal links, `[[Note]]` and Markdown links alike, lead where Obsidian's do: a name anywhere in the vault, nearest first, at the heading or block they name. Embedded images, `![[image.png|300]]`, show from Drive at the size they give, embedded notes show inline, the section or block they name, three deep at most, and other embeds are links.

## Signing in

**Sign in with Google** opens Google's window, so the browser must allow pop-ups for the site. The session then lasts about an hour for the tab: a reload keeps it, while a new tab or a relaunch of the Home Screen app asks for **Continue**, which renews it for the account remembered on the device, usually with a window that closes by itself. Once the hour is up, the next tap that opens a page renews the session in the same way, and a page that loads without a tap asks for **Continue**. **Sign out** forgets the session on the device, in every open tab, without revoking DriveMD's access to the Google account. It also discards the unsaved changes kept on the device for the account, after saying how many notes have some.

## Stack

Vite, React and TypeScript; Google Identity Services and the Drive REST API v3, with TanStack Query caching Drive's answers; CodeMirror 6 for editing and react-markdown for rendering; Firebase Hosting. The spec explains each choice.

## Development

You need Node.js 22.22.2 or later on the 22 line (`.nvmrc`), or 24.15.0 or later on the 24 line, and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173, not `127.0.0.1`: it is the only local origin the OAuth client authorizes, so the dev server refuses to start on another port.

| Command                    | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `npm run dev`              | Serve the app with hot reload                                   |
| `npm run build`            | Type-check, then build the static site into `dist/`             |
| `npm run preview`          | Serve the `dist/` build on the same port                        |
| `npm test`                 | Run the tests in watch mode                                     |
| `npm run coverage`         | Run the tests once; fails under the coverage thresholds         |
| `npm run e2e`              | Run the end-to-end tests in real browsers                       |
| `npm run lint`             | Lint with type-aware and security rules; any warning fails      |
| `npm run format`           | Format every file with Prettier (`npm run format:check` checks) |
| `npm run deploy`           | Deploy `dist/` to the site mapped to the `app` target           |
| `npm run live-check:login` | Sign the test account in for the live Drive checks              |
| `npm run live-check`       | Check the Drive client against the real Drive                   |
| `npm run live-check:ui`    | Check the deployed app on the real Drive, in real browsers      |

Write the failing test first, then the code that makes it pass. CI runs the checks above on every pull request and on every push to `dev` and `main`.

## End-to-end tests

`npm run e2e` builds the app and serves it with the headers Firebase Hosting sends, its security policy included. It then drives the app with Playwright in Chromium, as a desktop, and in WebKit, as an iPad and an iPhone held upright and sideways. Google's sign-in script and the Drive API are replaced by made-up ones (`e2e/fake-google.ts`), so the tests need no account and never reach Google. A test fails on any page error and on anything the security policy blocks.

Before the first run, download the browsers once with `npx playwright install chromium webkit`: they go to `~/.cache/ms-playwright`, shared by every project on the machine. WebKit also needs system libraries, which `sudo npx playwright install-deps webkit` installs. CI installs both on every run, and staging deploys only once the tests pass. The tests record no traces, screenshots or videos, which would keep the requests the app makes.

## Configuration

The app reads its settings from `VITE_*` environment variables when it is built. For development, copy `.env.example` to `.env.local` and fill it in; git ignores `.env` and `.env.local`.

| Variable                | Value                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | ID of the OAuth client of type Web application, from the spec's [Google Cloud setup](docs/SPEC.md#google-auth-scopes-and-workspace-setup) |

## Live Drive checks

The unit tests replace Google Drive with mocked answers, so a few behaviors can only be checked against the real Drive. The live checks do it as a test account of our organization, never with a person's account: its Drive holds nothing but what the checks create, a made-up file `drivemd-live-view-only.md` that another account shares with it as a viewer, and a shared drive named `DriveMD live check` where it is a content manager, holding a made-up file `drivemd-live-from-another.md` that another member added. Nothing about the account enters the repository. Its credentials stay in `~/.config/drivemd-live/`, or in the absolute path set in `DRIVEMD_LIVE_DIR`: the desktop OAuth client as `client.json` and the account's grant as `grant.json`. The scripts read them only when they are yours and nobody else can read them, and check with Drive that the grant belongs to the account it names before they act.

To set up, once:

1. Create an OAuth client of type **Desktop app** in the Google Cloud project, download its JSON, and save it as `client.json` in that folder, then `chmod 700` the folder and `chmod 600` the file.
2. In your own terminal, since it asks you to paste an address, run `DRIVEMD_LIVE_ACCOUNT=<test account> npm run live-check:login`. Open the address it prints, sign in as the test account and allow access; the browser then fails to load `127.0.0.1`, and you paste its address back. The script keeps the grant only if the test account signed in, and revokes any grant it cannot keep or that it replaces; it saves the grant as `grant.json`, readable only by you.

Then `npm run live-check` runs the checks, which CI never does. Among them, notes written as another tool would, with CRLF and a byte order mark, LF or CR line breaks, are opened, decoded and saved with one task checked, and Drive must then hold the same bytes but that one; a note that is not UTF-8 must open read-only, and a save over someone else's change must write nothing. A file must also be found by its exact name, whatever its case, as Obsidian's links find notes, accented names included, and the folders of several folders must list in one call; and Drive must name no folder of a file shared alone that the account cannot reach. They make what they need in a folder of their own in the test account's Drive and trash it at the end, and they compare IDs rather than listings, so that no failure prints the names of other files. A check that needs one of the made-up files or the shared drive is skipped until it exists.

`npm run live-check:ui` checks the deployed app the same way, in Chromium as a desktop and WebKit as an iPhone: staging by default, or the address in `DRIVEMD_LIVE_URL`. It hands the page the test account's session as a sign-in would leave it, so Google's window never opens; it then reaches notes in My Drive, a shared drive, a vault and behind a shortcut, finds one on Home and by search, and creates, renames, moves and trashes one, in a folder of its own that it trashes at the end. It also checks a task and edits a note's source in the deployed app, and finds Drive holding the bytes it should, and it opens a note of a vault written as Obsidian would, with a callout, a highlight, a tag, a comment, a link and embeds of a note's section and a picture, which must show and lead to the files they name. It fails on any page error and on anything the security policy blocks that the app depends on. It records no traces, screenshots or videos, which would keep the token.

## Security

The app's access token can read and write the user's whole Drive, so the repository guards against injected code and a compromised supply chain:

- Strict TypeScript and type-aware ESLint, whose rules reject `eval` and unsanitized DOM sinks such as `innerHTML` and `dangerouslySetInnerHTML`.
- The Drive client sends the token only in the `Authorization` header, refuses an ID that is not shaped like a Drive ID before it reaches a URL or a query, escapes search text, and keeps Drive's answers out of the browser's HTTP cache.
- `firebase.json` serves a strict Content Security Policy that enforces Trusted Types and allows no images but the app's own and the object URLs it makes for images read from Drive, nor any inline style: the editor styles itself in a shadow root, through constructed style sheets, along with HSTS, isolation from other origins' windows and requests, and no MIME sniffing. `src/security-headers.test.ts` fails if any of them weakens.
- `.npmrc` saves exact versions in `package.json`, turns off dependency install scripts and refuses Node.js versions outside `engines`. After adding a dependency, check that it works without its install script.
- CI installs from the lockfile with `npm ci`, verifies registry signatures, blocks malware and critical advisories in any dependency, and blocks any advisory in the dependencies that ship.
- Dependabot proposes npm and GitHub Actions updates weekly, for releases at least 7 days old.
- Workflows pin every action to a commit SHA, start from no permissions and grant each job only what it needs; zizmor audits them in CI, and gitleaks scans the full history on every push. The zizmor and gitleaks versions are pinned in the workflows and bumped by hand.

## Deployment

Once CI passes, every push to `dev` deploys staging, https://md-staging.corp.edgeweave.tech, to the `FIREBASE_HOSTING_SITE` site of the `FIREBASE_PROJECT_ID` project: `firebase.json` names the deploy target `app`, and CI maps it to that site. The deploy job only runs firebase-tools on the `dist/` that the check job built, and it authenticates through Workload Identity Federation, so no service account key exists. The job is skipped while `FIREBASE_PROJECT_ID` is unset; once it is set, CI stops before building if any other variable below is missing:

| Variable                         | Value                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | The Google Cloud project that hosts staging                                         |
| `FIREBASE_HOSTING_SITE`          | The Hosting site that serves staging, such as `<project>-staging`                   |
| `VITE_GOOGLE_CLIENT_ID`          | The OAuth client ID that the build embeds, as in Configuration                      |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/drivemd` |
| `GCP_SERVICE_ACCOUNT`            | `github-deploy@<project>.iam.gserviceaccount.com`                                   |

One-time setup, by an owner of the project:

1. Add Firebase to the project, start Hosting, add the staging site (`FIREBASE_HOSTING_SITE`), and connect the custom domain `md-staging.corp.edgeweave.tech` to that site.
2. Create the deploy account, which can only manage Firebase Hosting, and let only the CI workflow of this repository, on `dev`, use it:

```sh
PROJECT_ID=<project-id>
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REPO_ID=$(gh api repos/edgeweave-loom/drivemd --jq .id)
SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts create github-deploy --project "$PROJECT_ID" --display-name "GitHub staging deploy"
sleep 60  # IAM takes up to a minute before a new account can be granted roles.
for role in roles/firebasehosting.admin roles/serviceusage.apiKeysViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role "$role" --condition=None
done
gcloud iam workload-identity-pools create github --project "$PROJECT_ID" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc drivemd --project "$PROJECT_ID" --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
  --attribute-condition "assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/dev' && assertion.workflow_ref == 'edgeweave-loom/drivemd/.github/workflows/ci.yml@refs/heads/dev'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"

gh variable set FIREBASE_PROJECT_ID --body "$PROJECT_ID"
gh variable set FIREBASE_HOSTING_SITE --body "<staging-site-id>"
gh variable set GCP_SERVICE_ACCOUNT --body "$SA"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/drivemd"
```

The deploy account can manage every Hosting site of its project, so production (milestone 7) belongs in a project of its own.

CI deploys by itself. To deploy by hand, map the target to a site first, which writes a `.firebaserc` that git ignores: `npm exec --no -- firebase target:apply hosting app <site-id> --project <project-id>`, then `npm run deploy -- --project <project-id>`.

To see the headers and cache rules as Hosting serves them, run `npm run build`, map the target once with `npm exec --no -- firebase target:apply hosting app demo-drivemd --project demo-drivemd`, then run `npm exec --no -- firebase emulators:start --only hosting --project demo-drivemd` and open http://127.0.0.1:5000 (sign-in does not work on that origin).
