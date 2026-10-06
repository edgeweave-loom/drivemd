# Security policy

DriveMD's access token can read and write everything the user can reach in Google Drive, so we treat any way to run script in the app, to read its token, or to change a file the user did not edit as a serious vulnerability.

## Reporting a vulnerability

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**, or open [a new advisory](https://github.com/edgeweave-loom/drivemd/security/advisories/new). Do not open an issue or a pull request, which anyone can read.

Say what an attacker can do, and how: the steps, the browser and the device, and a made-up note or link that shows it. Leave out real file names, addresses and note contents, yours or anyone's.

We will confirm that we received the report, keep you informed while we fix it, and credit you in the advisory unless you prefer not to be named.

## Scope

In scope, in this repository's code and configuration:

- Script injection through a note, a link, a file name or an address of the app, or a way around the security policy and its Trusted Types.
- The access token leaving the tab, reaching a URL, a log or storage that outlives the tab, or being sent anywhere but Google.
- The app writing bytes the user did not edit, or writing over someone else's change without asking.
- The workflows, the build and the dependencies, including what could reach the deploy credentials.

Out of scope: Google's own services, and other organizations' deployments of DriveMD, whose operators answer for their configuration and hosting.

## Supported versions

Fixes go to `dev`, then to `main` in the next release. Only the latest release is supported.
