# Running your own DriveMD

DriveMD serves one Google Workspace organization. It asks for Google's `drive` scope, to edit files that other tools made: an app whose audience is **Internal**, the organization's own accounts, may use that restricted scope without Google's verification, while one open to other accounts must pass it, a security assessment included. Each organization therefore runs its own copy, from a Google Cloud project of its own. Edgeweave's copy is the reference: [`SPEC.md`](SPEC.md) describes it, with Edgeweave's addresses.

## Steps

1. In a Google Cloud project of your organization, enable the Google Drive API, set the audience to **Internal** in Google Auth Platform, and create an OAuth client of type **Web application** whose authorized JavaScript origins are your app's addresses, and `http://localhost:5173` for development. The spec's [Google Cloud setup](SPEC.md#google-auth-scopes-and-workspace-setup) gives each step, with Edgeweave's addresses.
2. Rewrite `about.html`, which speaks for Edgeweave, with your own description, privacy policy, terms and support, and point its source code link at your copy's source: the AGPL asks whoever serves a modified version to its users to offer them its source. `e2e/about.e2e.ts` checks the page's links.
3. Build with your client's ID, `VITE_GOOGLE_CLIENT_ID=<client-id> pnpm run build`, and serve `dist/` over HTTPS. Firebase Hosting serves it as `firebase.json` says, and [Deployment](#deployment) has CI deploy it. Another host must send the same headers, the Content Security Policy above all, which keeps script in a note from reaching the user's token, and serve the files of `dist/` as they are and `index.html` for any other path.
4. To open .md files from Drive's **Open with**, list the app as [Drive integration](#drive-integration) says.

## Configuration

The app reads its settings from `VITE_*` environment variables when it is built. For development, copy `.env.example` to `.env.local` and fill it in; git ignores `.env` and `.env.local`.

| Variable                | Value                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | ID of the OAuth client of type Web application, from [Steps](#steps); sign-in stays disabled while it is empty |

## Deployment

Once CI passes, every push to `dev` deploys staging to the `FIREBASE_HOSTING_SITE` site of the `FIREBASE_PROJECT_ID` project, and every push to `main` deploys production to the `PRODUCTION_FIREBASE_HOSTING_SITE` site of the same project: `firebase.json` names the deploy target `app`, and CI maps it to the site. The deploy job only runs firebase-tools on the `dist/` that the check job built, and it authenticates through Workload Identity Federation, so no service account key exists. In Edgeweave's repository, staging is https://md-staging.corp.edgeweave.tech, and production https://md.corp.edgeweave.tech. The job is skipped while `FIREBASE_PROJECT_ID` is unset, so a fork deploys nothing until it sets its own, and for `main` while `PRODUCTION_FIREBASE_HOSTING_SITE` is too; once they are set, CI stops before building if any other variable below is missing:

| Variable                           | Value                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`              | The Google Cloud project that hosts both sites                                      |
| `FIREBASE_HOSTING_SITE`            | The Hosting site that serves staging, such as `<project>-staging`                   |
| `PRODUCTION_FIREBASE_HOSTING_SITE` | The Hosting site that serves production, such as the project's default, `<project>` |
| `VITE_GOOGLE_CLIENT_ID`            | The OAuth client ID that the build embeds, as in [Configuration](#configuration)    |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`   | `projects/<number>/locations/global/workloadIdentityPools/github/providers/drivemd` |
| `GCP_SERVICE_ACCOUNT`              | `github-deploy@<project>.iam.gserviceaccount.com`                                   |

One-time setup, by an owner of the project:

1. Add Firebase to the project, start Hosting, add the staging site (`FIREBASE_HOSTING_SITE`), and connect your staging domain to that site and your production domain to the production site (`PRODUCTION_FIREBASE_HOSTING_SITE`, the project's default one or another), adding the DNS records Firebase gives. Make the staging domain a sibling of production's, not a subdomain of it, as the spec's Domains explains.
2. Create the deploy account, which can only manage Firebase Hosting, and let only the CI workflow of your repository, `<owner>/<repo>`, on `dev` and `main`, use it:

```sh
PROJECT_ID=<project-id>
# GitHub's own spelling of the repository, since the condition below compares it case for case.
REPO=$(gh repo view <owner>/<repo> --json nameWithOwner --jq .nameWithOwner)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REPO_ID=$(gh api "repos/$REPO" --jq .id)
SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts create github-deploy --project "$PROJECT_ID" --display-name "GitHub deploy"
sleep 60  # IAM takes up to a minute before a new account can be granted roles.
for role in roles/firebasehosting.admin roles/serviceusage.apiKeysViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" --role "$role" --condition=None
done
gcloud iam workload-identity-pools create github --project "$PROJECT_ID" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc drivemd --project "$PROJECT_ID" --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
  --attribute-condition "assertion.repository_id == '$REPO_ID' && assertion.event_name in ['push', 'workflow_dispatch'] && assertion.ref in ['refs/heads/dev', 'refs/heads/main'] && assertion.workflow_ref == '$REPO/.github/workflows/ci.yml@' + assertion.ref"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"

gh variable set VITE_GOOGLE_CLIENT_ID --repo "$REPO" --body "<client-id>"
gh variable set FIREBASE_PROJECT_ID --repo "$REPO" --body "$PROJECT_ID"
gh variable set FIREBASE_HOSTING_SITE --repo "$REPO" --body "<staging-site-id>"
gh variable set PRODUCTION_FIREBASE_HOSTING_SITE --repo "$REPO" --body "<production-site-id>"
gh variable set GCP_SERVICE_ACCOUNT --repo "$REPO" --body "$SA"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/drivemd"
```

A run deploys only its branch's latest commit: re-running an older one fails rather than putting its older build back, and Hosting's release history, in the Firebase console, rolls a site back. Each deploy to `main` also tags a release, as [Releases](development.md#releases) explains.

Both sites belong to one project, which also holds the OAuth client, the Drive UI integration and the Marketplace listing. Firebase grants Hosting rights on a whole project, not on a site, so the deploy account can deploy either site: whatever reaches `dev` must be trusted as much as what reaches `main`.

CI deploys by itself. To deploy by hand, map the target to a site first, which writes a `.firebaserc` that git ignores: `pnpm exec firebase target:apply hosting app <site-id> --project <project-id>`, then `pnpm run deploy --project <project-id>`.

To see the headers and cache rules as Hosting serves them, run `pnpm run build`, map the target once with `pnpm exec firebase target:apply hosting app demo-drivemd --project demo-drivemd`, then run `pnpm exec firebase emulators:start --only hosting --project demo-drivemd` and open http://127.0.0.1:5000 (sign-in does not work on that origin).

## Drive integration

Drive's **Open with** menu opens production through a private Google Workspace Marketplace listing, installed for the organization, which the spec's [Drive integration section](SPEC.md#drive-open-with-integration-via-private-marketplace) sets up step by step in the Google Cloud and Admin consoles; follow it with your own addresses. In Drive's settings, under Manage apps, each user can make DriveMD the default app for .md files, so that a double click opens it rather than Google Docs. Drive's **New** menu does not offer DriveMD, as the spec's requirement 9 explains. [`listing/`](listing/) holds the images the listing uploads: the icons, `public/icon.svg` rendered at 16, 32, 48, 64, 96, 128 and 256 pixels on a transparent background, the card banner and a screenshot taken on made-up data.
