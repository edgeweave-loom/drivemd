# Contributing to DriveMD

Thank you for helping. DriveMD holds a token that can read and write the user's whole Google Drive, and it edits files that other tools depend on, so every change follows a few rules, which CI enforces where it can.

## Before you start

- [`docs/SPEC.md`](docs/SPEC.md) is the source of truth for what the app does and why. Read the parts your change touches; to change a behavior the spec decides, open an issue first, so that the decision is made before the code.
- The app must never alter bytes the user did not edit: the spec's "Risks and gotchas" lists the traps, such as line endings, byte order marks, encodings and MIME types.
- Report a vulnerability privately, as [`SECURITY.md`](SECURITY.md) explains, never in an issue.
- Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Issues are public

Anyone can read the issues, the pull requests and the whole history. Leave out page addresses, file and folder names, email addresses and what your notes hold, and show a problem with a note made up for it.

The same goes for the repository: tests, fixtures and examples use made-up data, never a real Drive file ID, email address or note, and no secret, token or credential is ever committed, even briefly, since deleting it later leaves it in the history. Configuration comes from environment variables, with placeholders in `.env.example`.

## Making a change

1. Fork the repository and branch from `dev`. `main` holds what is released: `dev` reaches it through release pull requests.
2. Set up as [`docs/development.md`](docs/development.md#setup) says, its [End-to-end tests](docs/development.md#end-to-end-tests) included. The unit and end-to-end tests replace Google with made-up answers, so they need no Google account or OAuth client.
3. Write the failing test first, then the code that makes it pass. Browser behavior is tested with `pnpm run e2e`, in Chromium and WebKit, under the security policy that Hosting sends.
4. Before pushing, run the checks that CI runs on the code: `pnpm run check` (lint, format, coverage and build) and `pnpm run e2e`. The Git hooks that its Setup turns on run `pnpm run check` before each push, and check the format and the lint of each commit. CI also audits the dependencies and the workflows.
5. Update the spec in the same pull request when a decision changes, and the README or the guides in `docs/` when commands, environment variables or behavior do.
6. Open the pull request against `dev`.

The live Drive checks, `pnpm run live-check` and `pnpm run live-check:ui`, run as a test account of Edgeweave's organization, which only the maintainers use.

## Pull requests

- Keep a pull request under about 400 changed lines, and split larger work into pull requests that can be merged one by one.
- Pull requests are squashed into one commit, so write the title and body as that commit: the title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), `type(scope): subject`, in English, and the body says why the change exists.
- Keep the linter, the formatter and the type checker strict: fix the code rather than weaken a rule.
- Prefer what the platform and the current dependencies already offer. A new dependency runs with the user's Drive token, so say why it is needed, and check that it works without its install script, which `pnpm-workspace.yaml` turns off.
- Keep the security policy as strict as `src/security-headers.test.ts` holds it, and add no `eval`, `innerHTML` or other unsanitized DOM sink.

## License

DriveMD is under the GNU Affero General Public License, version 3 or later. By opening a pull request, you agree that your contribution is licensed under the same terms.
