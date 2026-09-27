# DriveMD

Browse, view and edit the Markdown files in our Google Drive, on desktop and on phones (iPhone first, Android too), including notes in Obsidian vaults.

DriveMD is a static web app for our Google Workspace organization. It signs in with Google, calls the Drive API straight from the browser, and never rewrites a file it did not change.

## Status

Nothing runs yet: the project is at the specification stage. The product spec, [`docs/SPEC.md`](docs/SPEC.md), is the source of truth, and its build plan drives the work one milestone at a time.

## Stack

Vite, React and TypeScript; Google Identity Services and the Drive REST API v3; CodeMirror 6 for editing and react-markdown for rendering; Firebase Hosting. The spec explains each choice.
