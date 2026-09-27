# DriveMD

Browse, view and edit the Markdown files in our Google Drive, on desktop and on phones (iPhone first, Android too), including notes in Obsidian vaults.

DriveMD is a static web app for our Google Workspace organization. It signs in with Google, calls the Drive API straight from the browser, and never rewrites a file it did not change.

## Status

Milestone 1 is in progress: the app builds and shows its shell; sign-in and the staging deployment come next. The product spec, [`docs/SPEC.md`](docs/SPEC.md), is the source of truth, and its build plan drives the work one milestone at a time.

## Stack

Vite, React and TypeScript; Google Identity Services and the Drive REST API v3; CodeMirror 6 for editing and react-markdown for rendering; Firebase Hosting. The spec explains each choice.

## Development

You need Node.js 22 (see `.nvmrc`) and npm.

```sh
npm ci
npm run dev
```

The dev server runs at http://localhost:5173 and refuses to start on another port: it is the only local origin the OAuth client authorizes.

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `npm run dev`      | Serve the app with hot reload                                   |
| `npm run build`    | Type-check, then build the static site into `dist/`             |
| `npm run preview`  | Serve the `dist/` build on the same port                        |
| `npm test`         | Run the tests in watch mode                                     |
| `npm run coverage` | Run the tests once; fails under the coverage thresholds         |
| `npm run lint`     | Lint with type-aware and security rules; any warning fails      |
| `npm run format`   | Format every file with Prettier (`npm run format:check` checks) |

Write the failing test first, then the code that makes it pass. CI runs the checks above on every pull request and on every push to `dev` and `main`, after `npm audit signatures` and `npm audit --audit-level=high`.

`.npmrc` turns off dependency install scripts and saves exact versions. After adding a dependency, check that it works without its install script.
