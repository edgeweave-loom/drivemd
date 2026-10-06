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

1. Fork the repository and branch from `dev`. `main` holds what is released, and reaches it from `dev` through release pull requests.
2. Set up as the README's [Development](README.md#development) section says. The unit and end-to-end tests replace Google with made-up answers, so they need no Google account or OAuth client.
3. Write the failing test first, then the code that makes it pass. Browser behavior is tested with `npm run e2e`, in Chromium and WebKit, under the security policy that Hosting sends.
4. Before pushing, run what CI runs: `npm run lint`, `npm run format:check`, `npm run coverage`, `npm run build` and `npm run e2e`.
5. Update the spec in the same pull request when a decision changes, and the README when commands, environment variables or behavior do.
6. Open the pull request against `dev`.

The live Drive checks, `npm run live-check` and `npm run live-check:ui`, run as a test account of Edgeweave's organization, which only the maintainers use.

## Pull requests

- Keep a pull request under about 400 changed lines, and split larger work into pull requests that can be merged one by one.
- Pull requests are squashed into one commit, so write the title and body as that commit: the title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), `type(scope): subject`, in English, and the body says why the change exists.
- Keep the linter, the formatter and the type checker strict: fix the code rather than weaken a rule.
- Prefer what the platform and the current dependencies already offer. A new dependency runs with the user's Drive token, so say why it is needed, and check that it works without its install script, which `.npmrc` turns off.
- Keep the security policy as strict as `src/security-headers.test.ts` holds it, and add no `eval`, `innerHTML` or other unsanitized DOM sink.

## License

DriveMD is under the GNU Affero General Public License, version 3 or later. By opening a pull request, you agree that your contribution is licensed under the same terms.
