# DriveMD

Browse, view and edit the Markdown files in our Google Drive, on desktop and on phones (iPhone first, Android too), including notes in Obsidian vaults.

DriveMD is a static web app for our Google Workspace organization. It signs in with Google, calls the Drive API straight from the browser, and never rewrites a file it did not change.

## Status

Milestone 1 is in progress: the app signs in with Google and shows the signed-in account's email, and CI deploys `dev` to staging. A test on a real iPhone decides next whether sign-in needs a small token backend. The product spec, [`docs/SPEC.md`](docs/SPEC.md), is the source of truth, and its build plan drives the work one milestone at a time.

## Signing in

**Sign in with Google** opens Google's window, so the browser must allow pop-ups for the site. The session then lasts about an hour for the tab: a reload keeps it, while a new tab or a relaunch of the Home Screen app asks for **Continue**, which renews it for the account remembered on the device, usually with a window that closes by itself. **Sign out** forgets the session on the device, in every open tab, without revoking DriveMD's access to the Google account.

## Stack

Vite, React and TypeScript; Google Identity Services and the Drive REST API v3; CodeMirror 6 for editing and react-markdown for rendering; Firebase Hosting. The spec explains each choice.

## Development

You need Node.js 22.22.2 or later on the 22 line (`.nvmrc`), or 24.15.0 or later on the 24 line, and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173, not `127.0.0.1`: it is the only local origin the OAuth client authorizes, so the dev server refuses to start on another port.

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `npm run dev`      | Serve the app with hot reload                                   |
| `npm run build`    | Type-check, then build the static site into `dist/`             |
| `npm run preview`  | Serve the `dist/` build on the same port                        |
| `npm test`         | Run the tests in watch mode                                     |
| `npm run coverage` | Run the tests once; fails under the coverage thresholds         |
| `npm run lint`     | Lint with type-aware and security rules; any warning fails      |
| `npm run format`   | Format every file with Prettier (`npm run format:check` checks) |
| `npm run deploy`   | Deploy `dist/` to Firebase Hosting (CI deploys staging)         |

Write the failing test first, then the code that makes it pass. CI runs the checks above on every pull request and on every push to `dev` and `main`.

## Configuration

The app reads its settings from `VITE_*` environment variables when it is built. For development, copy `.env.example` to `.env.local` and fill it in; git ignores `.env` and `.env.local`.

| Variable                | Value                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | ID of the OAuth client of type Web application, from the spec's [Google Cloud setup](docs/SPEC.md#google-auth-scopes-and-workspace-setup) |

## Security

The app's access token can read and write the user's whole Drive, so the repository guards against injected code and a compromised supply chain:

- Strict TypeScript and type-aware ESLint, whose rules reject `eval` and unsanitized DOM sinks such as `innerHTML` and `dangerouslySetInnerHTML`.
- `firebase.json` serves a strict Content Security Policy that enforces Trusted Types, along with HSTS, isolation from other origins' windows and requests, and no MIME sniffing. `src/security-headers.test.ts` fails if any of them weakens.
- `.npmrc` saves exact versions in `package.json`, turns off dependency install scripts and refuses Node.js versions outside `engines`. After adding a dependency, check that it works without its install script.
- CI installs from the lockfile with `npm ci`, verifies registry signatures, blocks malware and critical advisories in any dependency, and blocks any advisory in the dependencies that ship.
- Dependabot proposes npm and GitHub Actions updates weekly, for releases at least 7 days old.
- Workflows pin every action to a commit SHA, start from no permissions and grant each job only what it needs; zizmor audits them in CI, and gitleaks scans the full history on every push. The zizmor and gitleaks versions are pinned in the workflows and bumped by hand.

## Deployment

Once CI passes, every push to `dev` deploys staging, https://md-staging.corp.edgeweave.tech, to the default Firebase Hosting site of the `FIREBASE_PROJECT_ID` project. The deploy job only runs firebase-tools on the `dist/` that the check job built, and it authenticates through Workload Identity Federation, so no service account key exists. The job is skipped until these repository variables are set:

| Variable                         | Value                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | The Google Cloud project that hosts staging                                         |
| `VITE_GOOGLE_CLIENT_ID`          | The OAuth client ID that the build embeds, as in Configuration                      |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/drivemd` |
| `GCP_SERVICE_ACCOUNT`            | `github-deploy@<project>.iam.gserviceaccount.com`                                   |

One-time setup, by an owner of the project:

1. Add Firebase to the project, start Hosting, and connect the custom domain `md-staging.corp.edgeweave.tech`.
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
gh variable set GCP_SERVICE_ACCOUNT --body "$SA"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/drivemd"
```

The deploy account can manage every Hosting site of its project, so production (milestone 7) belongs in a project of its own.

To see the headers and cache rules as Hosting serves them, run `npm run build`, then `npx firebase emulators:start --only hosting --project demo-drivemd`, and open http://127.0.0.1:5000 (sign-in does not work on that origin).
