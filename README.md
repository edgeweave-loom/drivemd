# DriveMD

[![CI](https://github.com/edgeweave-loom/drivemd/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/edgeweave-loom/drivemd/actions/workflows/ci.yml?query=branch%3Adev)
[![Release](https://img.shields.io/github/v/release/edgeweave-loom/drivemd)](https://github.com/edgeweave-loom/drivemd/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

Browse, view and edit the Markdown files in Google Drive, on a computer and on a phone, Obsidian vaults included, without ever changing a byte you did not edit.

![A note edited in DriveMD's Visual mode on a computer, with headings, tasks, a rule and a table, on made-up data](docs/images/desktop-visual.png)

DriveMD is a static web app for a Google Workspace organization. It signs in with Google and calls the Drive API straight from the browser: there is no server of its own, and notes stay in Drive. Edgeweave builds it in the open and runs it in production for its own organization; another organization [runs its own copy](#running-your-own).

## Features

- **Your Drive, as Drive shows it.** Home lists the notes opened last and the Obsidian vaults; My Drive, Shortcuts, Shared drives and Shared with me open folder by folder, and a search box finds notes by name in every drive, or opens a pasted Drive link.
- **Rendered as GitHub does.** Tables, task lists, footnotes, highlighted code, front matter, relative links and images from Drive, and a tap on a task saves it at once.
- **Three ways to edit.** **Visual** edits the note on one sheet with Markdown's symbols hidden, **Source** shows the source beside its preview, and **Viewing** reads it. Find and replace, a keyboard toolbar on touch screens, and Cmd/Ctrl+S.
- **Safe with files other tools wrote.** A save changes only the lines edited, keeps Windows line breaks and byte order marks, never writes over someone else's change without asking, and keeps the revision from before the edits in Drive's history. Unsaved changes stay on the device until they are saved or discarded.
- **Obsidian vaults.** Inside a vault, notes show as Obsidian's reading view does: `[[links]]` and embeds found across the vault, callouts, highlights, tags, comments and the vault's line breaks.
- **Part of Google Drive.** Drive's **Open with** opens a .md file in DriveMD, once the organization lists it in its private Google Workspace Marketplace.
- **Made for phones too.** iPhone first, Android too: on the Home Screen or installed, clear of the notch, in a light or dark theme that follows the system, and in Android's share sheet.

<p align="center">
  <img src="docs/images/phone-home.png" width="250" alt="Home on an iPhone, with Recent, the vaults and the drives">
  <img src="docs/images/phone-dark.png" width="250" alt="A note read on an iPhone, in the dark theme">
  <img src="docs/images/phone-visual.png" width="250" alt="A note edited in Visual on an iPhone">
</p>

[`docs/user-guide.md`](docs/user-guide.md) walks through each screen.

## Status

DriveMD's first version, the nine milestones of the spec's [build plan](docs/SPEC.md#build-plan-for-claude-code), is built and runs in production at Edgeweave, and checks on real iPhones and Android phones go on as changes land. The second version, an Obsidian-style live preview, comes in stages: **Visual** already hides Markdown's symbols and draws lists, tasks, rules and tables, and images come next. [Releases](https://github.com/edgeweave-loom/drivemd/releases) list what each version brought.

DriveMD does not search inside notes, render math or Mermaid diagrams, run Obsidian plugins, nor save offline: the spec's [scope](docs/SPEC.md#users-platforms-and-scope) lists what is left out.

## Documentation

| Document                                       | For                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [`docs/user-guide.md`](docs/user-guide.md)     | Using DriveMD: signing in, finding, reading and editing notes, vaults, phones |
| [`docs/self-hosting.md`](docs/self-hosting.md) | Running a copy for your organization: Google Cloud, build, deploy, Drive      |
| [`docs/development.md`](docs/development.md)   | Building and testing: commands, end-to-end, live and device checks, releases  |
| [`docs/SPEC.md`](docs/SPEC.md)                 | The product spec, the source of truth for what the app does and why           |
| [`docs/DESIGN.md`](docs/DESIGN.md)             | The interface: tokens, components and mockups                                 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)           | Proposing a change                                                            |
| [`SECURITY.md`](SECURITY.md)                   | Reporting a vulnerability, privately                                          |

## Running your own

DriveMD asks for Google's full `drive` scope, to edit files that other tools made. An app open only to its own organization's accounts may use that scope without Google's verification, so each organization runs its own copy, from a Google Cloud project of its own: create an OAuth client, build with its ID, and serve `dist/` with the headers that `firebase.json` sets. [`docs/self-hosting.md`](docs/self-hosting.md) gives each step, and has CI deploy staging and production to Firebase Hosting without a stored key.

## Development

Vite, React and TypeScript; Google Identity Services and the Drive REST API v3, with TanStack Query; CodeMirror 6 for editing and react-markdown for rendering; Firebase Hosting. With [pnpm](https://pnpm.io/installation), which brings the pinned Node.js itself:

```sh
pnpm install
pnpm run dev     # http://localhost:5173
pnpm run check   # lint, format, unit tests with coverage, build
pnpm run e2e     # Chromium and WebKit, against a made-up Google
```

The tests need no Google account: they replace Google with made-up answers. [`docs/development.md`](docs/development.md) covers the rest, from the Git hooks to releases.

## Security

DriveMD's token can read and write the user's whole Drive, so the app runs under a strict Content Security Policy that enforces Trusted Types, sends the token to Google only, and loads no images from other sites. The repository pins its actions and dependencies, installs only releases at least a week old and runs none of their install scripts, audits them on every push and every day, and scans its history for secrets; [`docs/development.md`](docs/development.md#supply-chain-and-code-safety) lists every guard. Report a vulnerability privately, as [`SECURITY.md`](SECURITY.md) explains, never in an issue.

## Contributing

Contributions are welcome: [`CONTRIBUTING.md`](CONTRIBUTING.md) says how to propose a change, test first, against `dev`. Issues and pull requests are public: leave out real file names, addresses and notes. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

Copyright 2026 Edgeweave.

DriveMD is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. DriveMD is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose. See [`LICENSE`](LICENSE) for the full terms.

The app's icon draws the Markdown mark by Dustin Curtis, which he dedicated to the public domain. The icons in its pages, the keyboard toolbar's among them, are Google's [Material Symbols](https://github.com/google/material-design-icons), under the [Apache License 2.0](LICENSES/Apache-2.0.txt), whose text `LICENSES/Apache-2.0.txt` holds, but for those in a callout's title in an Obsidian vault, its type's icon and the chevron that folds it: Obsidian's own, [Lucide](https://lucide.dev)'s, under the ISC License, some of them from [Feather](https://github.com/feathericons/feather), under the MIT License, both in `LICENSES/Lucide.txt`, copied from lucide-static 1.26.0. Its fonts are [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex), copyright 2015 Google LLC, and [Google Sans Code](https://github.com/googlefonts/googlesans-code), copyright 2025 The Google Sans Code Project Authors, both under the [SIL Open Font License 1.1](LICENSES/OFL-1.1.txt), whose text `LICENSES/OFL-1.1.txt` holds; the app serves them itself, from the `@fontsource-variable` packages.
