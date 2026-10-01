# Drive Markdown Editor — Product Spec

Sep 27, 2026 · @gmasse

This file is the source of truth for the spec. It replaces the Claude Docs version it was exported from.

## Summary

We are building **DriveMD**, a web app to browse, view and edit Markdown (.md) files stored in our Google Drive, on desktop and on phones: iPhone first, Android too. It is for people in our Google Workspace organization only, and it must work on files created by other software. Some of these files live in Obsidian vaults stored in Drive; inside a vault, the app follows Obsidian's syntax and conventions.

The recommended approach is a static single-page app (Vite + React + TypeScript). It signs in with Google Identity Services, calls the Drive REST API v3 directly, edits with CodeMirror 6 and renders with react-markdown. The app has no backend: sign-in passed the milestone 1 test on a real iPhone, so v1 needs no token backend (see Tokens). Users reach files through a built-in file navigator, and on desktop also through Drive's own **Open with** menu, via a private Google Workspace Marketplace listing.

## Users, platforms and scope

Users are employees signed in with an account in our Workspace organization. Accounts outside the organization cannot sign in. Most users are technical and comfortable with Markdown syntax.

The interface is in English and follows the system's light or dark theme.

**Platforms**

- Desktop browsers: Chrome, Safari, Edge, Firefox
- iPhone (priority): Safari, in a normal tab or saved to the Home Screen
- Android: Chrome, in a normal tab or installed as an app
- Tablets: the wide layout, adapted to their width (see Mobile requirements)

**In scope for v1**

- Browse My Drive, Shared drives and Shared with me, with recent files and Obsidian vaults on Home
- View rendered Markdown, including Obsidian syntax inside a vault
- Edit and save Markdown source
- Create a new .md file in the current folder
- Rename, move and trash files
- Open a file from Drive on the web with **Open with**
- Open a file from a pasted Drive link or a bookmarked app URL

**Out of scope for v1**

- WYSIWYG editing (source editing keeps files byte-identical), and full Obsidian-style live preview (planned for v2, see Editor)
- Real-time multi-user collaboration
- Offline editing: unsaved text is kept on the device, but nothing reaches Drive while offline
- Converting to or from Google Docs
- Users outside our Workspace organization
- Searching inside file contents (search is by name)
- Rendering math and Mermaid diagrams (they show as written)
- Updating links in other notes when a file is renamed or moved
- Running Obsidian plugin syntax such as Dataview, Tasks, Templater or Bases (it shows as written)

## Functional requirements

1. **Sign-in.** Users sign in with their Google account. Only accounts in our Workspace organization are accepted.
2. **Home.** After sign-in, the app opens on Home, which shows in order:
   - **Recent:** the Markdown files the user opened most recently, newest first. The list comes from Drive's `viewedByMeTime`, which the app sets when it opens a file, so it is the same on every device. It keeps the Markdown files among the 100 files with content the user viewed last. Drive accepts it even for files the user can only view, and shows the new time a few seconds later (checked live).
   - **Vaults:** the Obsidian vaults found in Drive (see Obsidian vaults).
   - **Roots:** My Drive, Shortcuts, Shared drives and Shared with me.
3. **File navigator.** Shows four roots: My Drive, Shortcuts, Shared drives and Shared with me.
   - Lists folders, Markdown files (.md, .markdown) and Drive shortcuts that point to a folder or a Markdown file. Folders and folder shortcuts come first, then files, each sorted by name in natural order (`file2` before `file10`).
   - Folders and files whose name starts with a dot, such as `.obsidian` and `.trash`, are hidden.
   - Shortcuts work like the real thing: tapping a folder shortcut opens the target folder, tapping a file shortcut opens the target file. A small badge marks them as shortcuts.
   - The **Shared drives** root lists the shared drives the user is a member of, except those they hid in Drive, as Drive itself does.
   - The **Shortcuts** root lists the shortcuts the user owns, that is the ones they created outside shared drives, wherever they sit, for one-tap access. Shortcuts in shared drives are left out: the whole team creates them, and Drive cannot tell which ones the user made.
   - A broken shortcut (target deleted, in the trash, or no access) is shown greyed out with a short reason.
   - Breadcrumbs show the path the user took, including through a shortcut. When there is no such path (deep link, **Open with**, reloaded folder URL), they are rebuilt from the parents up to My Drive, the shared drive or Shared with me; a parent the user cannot access ends the path.
   - Every page has its own URL: `/` for Home; `/my-drive`, `/shortcuts`, `/shared-drives` and `/shared-with-me` for the roots; `/folder/<id>` for a folder; `/search?q=<text>` for search; and `/edit?id=<id>` for a file. `resourcekey=<key>` is added when the item needs one. The browser's history keeps the path the user took, so Back and a reload keep the breadcrumbs. A URL whose ID or key is not shaped like Drive's opens nothing.
   - A search box finds Markdown files by name across all drives. Drive matches the start of words, not any substring: "plan" finds `planning.md` but not `myplan.md`, and every word typed must match. It shows the Markdown files among the first 100 matches, the most recently modified first.
4. **Viewer.** Files open in the viewer by default, on every screen, with an **Edit** button.
   - Renders Markdown with GitHub-style extras: tables, task lists, strikethrough, autolinks and footnotes. Code blocks are syntax-highlighted. Math and Mermaid are not rendered; they show as written.
   - Raw HTML is rendered and sanitized as GitHub does, and HTML comments are hidden. Every id in a note gets GitHub's `user-content-` prefix, so that none can stand for one of the app's own, and headings get ids, so that `#heading` links scroll to them. YAML front matter shows as a properties table at the top instead of rendering as a heading; front matter that holds no properties, such as a list or YAML that does not parse, shows as written.
   - Relative links and images (`../other.md`, `img/a.png`) resolve against the file's folder in Drive. Links to Markdown files open in the app; other links open in a new tab. Images stored in Drive are fetched with the user's token. Images on other sites are not loaded: each shows as a link that opens it in a new tab, so that a note cannot make the app call another server.
   - Inside a vault, Obsidian syntax renders as described in Obsidian vaults.
   - Task checkboxes are tappable. Toggling one changes only `[ ]` to `[x]` (or back) in the source and marks the file as unsaved, like any other edit.
   - The header shows who last modified the file and when.
   - Files the user cannot edit (view or comment access, locked file) open read-only with a badge giving the reason, and **Edit** is hidden. Files the user cannot download show that reason instead of their content.
   - Files over 1 MB are not read, so that rendering never stalls a phone: the page gives their size and a link to open them in Google Drive.
5. **Editor.** Edits the raw Markdown source with CodeMirror 6 and Markdown syntax highlighting.
   - Wide screens show the editor and preview side by side. Phones use an Edit / Preview toggle.
   - **Light live styling (v1).** Headings shown larger, bold and italic styled, inline code and code blocks in monospace. Markdown symbols (`**`, `#`, `[]()`) are dimmed, never hidden, so cursor and selection behave normally on phones.
   - A tap or click in the editor only places the cursor; checkboxes and links react in the viewer and the preview. On desktop, Cmd/Ctrl+click opens a link from the editor, as in Obsidian.
   - Enter continues lists and task lists.
   - A search panel finds text in the file. The browser's own find misses text that CodeMirror has not drawn, since it renders only the visible part of the file.
   - **Full Obsidian-style live preview (v2).** Symbols hidden except on the line being edited, and images and tables rendered in the editor. A setting switches between full live preview, light styling and plain source. Details in the v2 live preview section.
   - All modes are CodeMirror 6 decorations over the same source text, so files stay byte-identical and v2 builds on v1 without rework.
6. **Save.** Explicit Save button plus Cmd/Ctrl+S; there is no autosave. The Save button shows whenever the file has unsaved changes, in the viewer too.
   - Unsaved text is kept on the device (IndexedDB) as the user types, so it survives a reload, a crash or iOS closing the app. Reopening the file offers to restore it.
   - The app writes only when the bytes actually changed.
   - Before writing, it checks that nobody else changed the file since it was opened (conflict check). If someone did, it shows the differences between the Drive version and the user's version, and the user chooses: keep the Drive version, overwrite it with their version, or save their version as a copy named `<name> (conflict).md` in the same folder. Restoring a local copy of a file that changed in Drive leads to the same choice.
   - Before the first write of an editing session, it marks the file's current revision as kept forever, so the pre-edit version survives Drive's revision cleanup. That revision stays in the file's version history until someone deletes it there, even when it holds text the user then removes on purpose, such as a pasted secret.
   - It warns before leaving a page with unsaved changes. iOS does not show this warning reliably; there, the local copy is the safety net.
7. **File operations.**
   - **Create** a new .md file in the current folder. The app asks for the name first (prefilled with `Untitled`, `.md` added) and never creates an unnamed file. **New** is offered only in a folder where the user can add files.
   - **Rename**, **Move** (with a folder picker) and **Move to trash** (after a confirmation; the file stays restorable from Drive's trash). Each action is hidden when the user's rights do not allow it.
   - Inside a vault, renaming or moving warns that links pointing to the file will not be updated: Obsidian updates them only when it renames the file itself. No other file is changed.
8. **Deep links.** Every file has its own URL, `/edit?id=FILE_ID`, plus `&resourcekey=KEY` when the file has a resource key. Pasting a Drive file link opens that file.
9. **Open with (desktop).** Opening a .md file from Drive on the web with **Open with** loads it in the app. **New** in Drive asks for a name, then creates the file in that folder.

**Shortcut implementation notes.** Shortcuts have MIME type `application/vnd.google-apps.shortcut`. Every listing requests `shortcutDetails(targetId,targetMimeType,targetResourceKey)` in its `fields`. The Shortcuts root queries `mimeType='application/vnd.google-apps.shortcut' and 'me' in owners and trashed=false`. Opening or listing always uses `targetId`, never the shortcut's own ID. Folder shortcuts are recognized by `targetMimeType`; file shortcuts by a name ending in .md or .markdown. A 404 on the target, or a target with `trashed=true`, marks the shortcut as broken. Checking targets costs one request per shortcut, so show the list at once, check the targets in parallel, and grey out each broken shortcut as its check returns; a check that fails leaves the shortcut as it is.

**Permission notes.** Request `capabilities` and `contentRestrictions` with every file and folder, and hide or disable whatever the user cannot do.

**Resource key notes.** Some files shared by link need a resource key. Keep it from listings, shortcut targets (`targetResourceKey`), pasted links (`resourcekey=`) and the **Open with** state, and send it in the `X-Goog-Drive-Resource-Keys` header on every call for that file.

## Obsidian vaults

A vault is a folder that contains a `.obsidian` folder. Inside a vault, the app follows Obsidian's rules; everywhere else, it follows GitHub's.

- **Finding vaults.** One query across all drives finds them: `name='.obsidian' and mimeType='application/vnd.google-apps.folder' and trashed=false`. The parents of the results are the vault roots, listed on Home.
- **Vault settings.** The app reads `.obsidian/app.json`; a missing key means Obsidian's default.
- **Line breaks.** By default, Obsidian shows a single line break as a line break, where GitHub joins the two lines. The viewer does the same, unless the vault's `strictLineBreaks` setting is on.
- **Rendered in v1:**
  - Properties (YAML front matter), as a table at the top of the note.
  - Callouts `> [!note] Title`, foldable with `[!faq]-` (collapsed) or `[!faq]+` (expanded), and nested. Types and aliases: note; abstract (summary, tldr); info; todo; tip (hint, important); success (check, done); question (help, faq); warning (caution, attention); failure (fail, missing); danger (error); bug; example; quote (cite). Unknown types render like note. GitHub alerts use the same syntax.
  - Highlights `==text==`; comments `%%text%%`, hidden; tags `#tag` and `#parent/child`, shown as labels without search; block IDs `^id`, hidden; inline footnotes `^[text]`.
  - Internal links `[[Note]]`, `[[Note|text]]`, `[[Note#Heading]]` and `[[Note#^block]]`, and Markdown links to notes such as `[text](My%20note.md)`. A tap opens the note in the app at that heading or block. A link that resolves to nothing is shown faded.
  - Image embeds `![[image.png]]`, with an optional width `![[image.png|300]]` or size `![[image.png|300x200]]`, fetched from Drive.
  - Note embeds `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]`, rendered inline. Embeds nest at most 3 levels deep, and a note that embeds itself, directly or through others, is not expanded again.
- **Shown as a plain link:** PDF, audio, video and canvas embeds.
- **Shown as written:** math, Mermaid and plugin syntax (Dataview, Tasks, Templater, Bases).
- **Link resolution.** Obsidian resolves `[[Note]]` by file name anywhere in the vault, not by path. The app looks the file up by exact name (`name='Note.md'`) and keeps matches inside the vault; when several match, it prefers the one in the current note's folder, then the one with the shortest path. A link with a path (`[[folder/Note]]` or a Markdown link) resolves relative to the note first, then from the vault root.

## Recommended tech stack

The app is a static page hosted on our own HTTPS domain; the browser talks to Google directly, so milestone 1 needs no server.

```text
Drive on the web: Open with, New ──┐
Home and file navigator ───────────┼──> Static app ──┬──> Google Identity Services: access token
Deep link or pasted Drive link ────┘    (browser)    └──> Drive REST API v3: list, read, write files
```

All three entry points load the same app, which gets a token from Google sign-in and then reads and writes files through the Drive API. The milestone 1 iPhone test showed that no token backend is needed; should one become necessary, it would handle sign-in only, and file content would still go straight between the browser and Drive.

**Domains.** Production is `md.corp.edgeweave.tech` and staging is `md-staging.corp.edgeweave.tech`, both in a dedicated `corp.edgeweave.tech` DNS zone that must exist before milestone 1. Staging is a sibling of production, not a subdomain of it, so a cookie set by production never reaches staging. CI deploys every push to `dev` to staging, authenticated through Workload Identity Federation rather than a service account key.

| Concern         | Choice                                                 | Notes                                                                                                                        |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Build and UI    | Vite + React + TypeScript                              | Static build, deployable to any HTTPS host                                                                                   |
| Sign-in         | Google Identity Services (token model)                 | `google.accounts.oauth2.initTokenClient`                                                                                     |
| Drive access    | Drive REST API v3 with plain `fetch`                   | Small typed wrapper; no `gapi` client needed                                                                                 |
| Editor          | CodeMirror 6 + `@codemirror/lang-markdown`             | Add `@codemirror/language-data` to highlight fenced code                                                                     |
| Preview         | `react-markdown` + `remark-gfm` + `remark-frontmatter` | `rehype-raw` + `rehype-sanitize` for HTML; `rehype-highlight` or Shiki for code                                              |
| Obsidian syntax | remark plugins                                         | Maintained plugins where one fits, such as `remark-breaks`; our own for link resolution and embeds, which need Drive lookups |
| Conflict view   | `@codemirror/merge`                                    | Shows the Drive version against the user's                                                                                   |
| Local copy      | IndexedDB                                              | Unsaved text, per file                                                                                                       |
| Navigator       | Custom drill-down list                                 | Optional `react-arborist` tree on wide screens                                                                               |
| Data caching    | TanStack Query                                         | Caches Drive's answers, one cache per account; retries only what may pass later                                              |
| Hosting         | Firebase Hosting                                       | Production and staging domains above                                                                                         |

## Google auth, scopes and Workspace setup

Set the OAuth app's audience to **Internal**: apps used only inside our Workspace organization can use sensitive and restricted scopes without Google's verification review ([Google: configure the OAuth consent screen](https://developers.google.com/gsuite/marketplace/configure-oauth-consent-screen)). This lets us use the full `drive` scope, which is needed to edit files created by other software.

**Google Cloud setup**

@gmasse, a Workspace admin, creates the project, handles the admin console and installs the Marketplace listing.

1. Create the Google Cloud project inside our Workspace organization, not under a personal Gmail account.
2. Enable the Google Drive API.
3. In Google Auth Platform, set Audience to **Internal**.
4. Create an OAuth client of type **Web application**. Add `https://md.corp.edgeweave.tech`, `https://md-staging.corp.edgeweave.tech` and `http://localhost:5173` (for development) as authorized JavaScript origins. Origins must match exactly, with no wildcards, and a phone cannot reach `localhost`: the staging domain is needed from milestone 1 to test on a real iPhone.
5. For the live Drive checks, create a second OAuth client of type **Desktop app**. Only a test account of the organization signs in with it, never a person's account, and its Drive holds nothing but what the checks create (see the README).

**Scopes**

| Scope                                           | Why                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/drive`         | Read and write every file the user can access, including files made by other tools |
| `https://www.googleapis.com/auth/drive.install` | Lets the app appear in Drive's Open with menu                                      |

The app shows the signed-in account's email from Drive's `about.get` (`fields=user(emailAddress)`), so it needs no `openid` or `email` scope.

**Tokens**

- Use the GIS token model (`initTokenClient`). Tokens last about 1 hour, and there is no refresh token without a backend.
- Every token request opens a Google popup, including a "silent" one with `prompt: ''`, which closes by itself. Browsers block a popup that does not come from a user gesture, so a timer cannot renew the token. When the token has expired or is about to, renew it only in a tap or click handler, before any `await`: on Save, when opening a file or folder, or from a **Continue** screen when the app starts or resumes without a valid token.
- Without a backend, the user therefore taps **Continue** in every new tab and at every app launch, and sees the popup open and close then, and again on the first tap after the token expires. On iPhone, the Home Screen app does not share Safari's Google session, and popups are less reliable there.
- The token is kept for the tab, in memory and in `sessionStorage`: a reload keeps the session, while a new tab or an app launch asks for **Continue**. It counts as expired once 5 minutes or less remain. The account's email stays on the device (`localStorage`) to offer **Continue** and to pass as `login_hint`. **Sign out** forgets both on the device, in every open tab, and does not revoke the grant, which would sign the user out on every device.
- On a 401, show **Continue**, then retry the call once with the new token. A save checks again for someone else's change before it retries, since the new token may have taken a while to come. Never drop the user's unsaved text when a token renewal fails.
- GIS can report its window as closed while it is still open, when the page in it cuts the window off from the app. The app therefore keeps waiting after that report and lets the next tap start a new request, instead of dropping a token that arrives later.
- **Decided at the end of milestone 1: no token backend.** Sign-in and renewal worked on a real iPhone, in a Safari tab and from the Home Screen, so the popup token model stays. If that changes, the fallback is a small token backend on Cloud Run: redirect sign-in with the authorization-code flow, the refresh token kept encrypted on the server, and short-lived access tokens handed to the app, while file content still goes straight between the browser and Drive. All sign-in code stays in one module (`src/auth.ts`) so that change would touch nothing else.

**Admin console**

As Workspace admin, @gmasse checks **Security > API Controls**. Admins can block any OAuth app, including internal ones; internal apps are trusted when "Trust internal, domain-owned apps" is on ([Google: production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)).

**Shared drives**

Every call on files must pass `supportsAllDrives=true`; the calls on shared drives and revisions take no such parameter. Listing a folder by its parent needs no `corpora`, even in a shared drive, where it shows every member's files (checked live). Listings also need `includeItemsFromAllDrives=true`, and cross-drive search uses `corpora=allDrives`.

## Drive "Open with" integration via private Marketplace

A private Google Workspace Marketplace listing puts the app in Drive's **Open with** menu for .md files, installed for the whole organization by our admin. The setup follows [Google: configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk).

**Drive UI integration (Cloud console > Google Drive API > Drive UI integration)**

1. Upload app icons (PNG, transparent background).
2. Set the **Open URL** to `https://md.corp.edgeweave.tech/open`. It must be a real domain (`localhost` is not accepted), and we must verify we own it before listing, for example with a DNS TXT record in the `corp.edgeweave.tech` zone through Google Search Console.
3. Set default file extension `md` (secondary: `markdown`), and MIME types `text/markdown` and `text/x-markdown`.
4. Tick **Creating files** and set the **New URL** to `https://md.corp.edgeweave.tech/new`.
5. Tick **Shared drive support**.

**Marketplace listing**

1. Enable the Google Workspace Marketplace SDK in the same project.
2. Configure the app with the Drive extension and publish it with **Private** visibility.
3. The admin installs it for the whole domain, so no user has to add it.

**Handling the redirect**

Drive opens our URL with a URL-encoded JSON `state` parameter. The app decodes it, gets a token (without a backend, after a tap on **Continue**), then loads the file(s).

```json
// Open URL
{ "ids": ["FILE_ID"], "resourceKeys": {}, "action": "open", "userId": "USER_ID" }
// New URL
{ "action": "create", "folderId": "FOLDER_ID", "userId": "USER_ID" }
```

For `open`, redirect to `/edit?id=<first id>`, adding its resource key from `resourceKeys` when there is one. For `create`, ask for the file name (prefilled with `Untitled`), create the file in `folderId`, then redirect to its `/edit` URL. If `userId` differs from the signed-in account, pass it as `login_hint` when requesting the token.

**Phone limit**

As far as we know, **Open with** for web apps works only in Drive on the web, not in the Drive iOS or Android apps; this needs checking on a real device. On phones, the app's own navigator and deep links are the entry points.

## Mobile requirements (iPhone first, Android too)

iPhone is the priority and Android must work too. On both, the app runs in the phone's browser, can be added to the home screen, and the built-in navigator is the main way in.

- **Home Screen app.** Add a web app manifest, icons, and `apple-mobile-web-app-capable`. The app's name, also shown under its icon, is **DriveMD**. Respect notch and home-bar areas with `env(safe-area-inset-*)`. Safari never offers to install a web app, so show a one-time hint on iPhone explaining **Share > Add to Home Screen**.
- **Sign-in.** Start the GIS popup only from a tap, or Safari blocks it. Sign-in passed the milestone 1 test in Home Screen (standalone) mode, so no token backend is needed (see Tokens).
- **Layout.**
  - Phone layout: a drill-down folder list with breadcrumbs, and an Edit / Preview toggle. It applies under 768 px wide, and on touch screens less than 500 px tall, so an iPhone in landscape (844 px wide or more) keeps it.
  - Wide layout: tree or list on the left, then the viewer, or the editor and preview side by side. Between 768 and 1024 px wide, as on an iPad in portrait, the tree folds into a drawer so the editor and preview keep enough room.
- **Editor.** Editor font size at least 16 px, so Safari does not zoom in on focus.
- **Keyboard toolbar (required on phones).** Pinned above the keyboard with the `visualViewport` API: undo, redo, heading, bold, list, checkbox, link, indent, outdent (the iPhone keyboard has no Tab key) and search in the file.
- **Smart punctuation.** Test iOS smart punctuation and autocorrect early: they can turn `"` into curly quotes and `--` into a dash, which breaks YAML and code. Decide from the results whether to turn them off in the editor.
- **Opening files.** Support `/edit?id=FILE_ID` links and pasting a Drive file link, so a file can move between desktop and phone.
- **Touch.** No hover-only controls; tap targets at least 44 px.

**Android specifics**

- **Install.** The same web app manifest lets Chrome offer "Install app"; test both the tab and the installed app.
- **Back button.** Give each folder its own URL (for example `/folder/<id>`), so the Android back button steps back through folders instead of leaving the app.
- **Share target.** Declare a `share_target` in the manifest (Web Share Target API) so a link shared from the Drive app opens in the installed app. iOS does not support this.
- **Keyboard.** Test the keyboard toolbar with Gboard and the Samsung keyboard; `visualViewport` works in Chrome on Android.
- **Browsers.** Test Chrome first; also Samsung Internet if people in the organization use it.

## Risks and gotchas

The biggest risk is damaging files other tools depend on, so the app must never rewrite a file it did not change.

| Risk                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Another tool or person edits the file while it is open                                                                 | Store `md5Checksum` and `headRevisionId` on open, reading them before the content so that it is never older than them, and re-read them before saving; if they changed, show the differences and let the user choose (see Save). Do not rely on `version`, which also changes with sharing and metadata                                                                                                                                                                                    |
| .md files carry inconsistent MIME types (`text/markdown`, `text/x-markdown`, `text/plain`, `application/octet-stream`) | List a folder's children, then filter by name ending in `.md` or `.markdown` in the app, not by MIME type                                                                                                                                                                                                                                                                                                                                                                                  |
| Line endings, encoding or a trailing newline change silently                                                           | Set CodeMirror's `EditorState.lineSeparator` to the file's separator (it joins lines with `\n` by default). Decode with `ignoreBOM: true` to keep a UTF-8 BOM (`TextDecoder` and `Response.text()` drop it otherwise) and with `fatal: true`; open read-only a file that is not valid UTF-8, holds a NUL character (as UTF-16 without a byte order mark does, while passing for UTF-8) or mixes line endings. Compare bytes before writing, and upload with the file's existing `mimeType` |
| Unsaved text is lost when iOS closes the app                                                                           | Keep unsaved text in IndexedDB as the user types; offer to restore it on reopen                                                                                                                                                                                                                                                                                                                                                                                                            |
| Drive deletes old revisions (after 30 days or 100 versions for non-Google files)                                       | Mark the pre-edit revision as kept forever before the first write of a session (Drive allows 200 such revisions per file)                                                                                                                                                                                                                                                                                                                                                                  |
| Access token expires during a long edit                                                                                | Renew inside a user gesture (Save, **Continue**); keep unsaved text; retry once                                                                                                                                                                                                                                                                                                                                                                                                            |
| iOS blocks the sign-in popup, or popups fail in Home Screen mode                                                       | Trigger sign-in from a tap; the milestone 1 test passed in Safari and from the Home Screen; a small token backend with redirect sign-in remains the fallback                                                                                                                                                                                                                                                                                                                               |
| Admin API Controls block the app                                                                                       | Ask the admin to mark it Trusted, or turn on trust for internal apps                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rendered Markdown runs injected HTML or scripts                                                                        | Sanitize HTML with `rehype-sanitize` (GitHub schema) and set a strict Content Security Policy that enforces Trusted Types, locked by a test on `firebase.json`: with the full `drive` scope, an XSS exposes the user's whole Drive                                                                                                                                                                                                                                                         |
| The access token leaks through injected script or browser storage                                                      | Keep the token only for the tab (memory and `sessionStorage`), send it only in the `Authorization` header, never log it or put it in a URL or an error message, and forget it on sign-out or a 401; strict CSP with Trusted Types                                                                                                                                                                                                                                                          |
| Google's sign-in script runs with full page access and cannot be pinned with Subresource Integrity                     | The CSP allows only its exact URL, Trusted Types lets the app load it only through its own policy, and the CSP allows no other Trusted Types policy                                                                                                                                                                                                                                                                                                                                        |
| A compromised dependency or workflow abuses the staging deploy credentials                                             | Workload Identity Federation instead of a key, accepted only for this repository's CI workflow on `dev`; the deploy account can only manage Firebase Hosting; the job holding credentials runs no build tooling; actions are pinned by commit and audited by zizmor                                                                                                                                                                                                                        |
| A crafted note crashes the renderer or makes the Markdown parser run for seconds                                       | A note nested deeper than the renderer's stack shows as written instead of rendered. Parsing runs on the main thread, so a note built to make the parser slow (about 10 s for 12 KB) freezes its tab until it finishes or the tab is closed; parsing in a worker the app can stop is the fix if it matters in practice                                                                                                                                                                     |
| Renaming or moving a file in a vault breaks Obsidian links to it                                                       | Warn before renaming or moving inside a vault; never rewrite other files                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Some files shared by link need a resource key                                                                          | Carry `resourcekey` in links and send `X-Goog-Drive-Resource-Keys`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Large folders                                                                                                          | Paginate with `pageToken`; request only needed `fields`                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Build plan for Claude Code

Build in eight milestones, each ending with something that runs; give Claude Code this doc plus one milestone at a time.

1. **Scaffold, sign-in and iPhone test.** Vite + React + TypeScript project; client ID in `VITE_GOOGLE_CLIENT_ID`; GIS token helper in one module, requesting tokens only from user gestures; sign-in, **Continue** and sign-out screens; deployment to `md-staging.corp.edgeweave.tech` on Firebase Hosting.
   - Done when: an org account signs in and the app shows the user's email, on desktop and on a real iPhone (Safari tab and Home Screen), and the token backend decision is recorded in this spec.
2. **Drive client.** One typed module: `listChildren`, `listSharedDrives`, `listSharedWithMe`, `listShortcuts`, `listRecent`, `markViewed`, `findVaults`, `search`, `getMetadata`, `getContent`, `saveContent`, `createFile`, `renameFile`, `moveFile`, `trashFile`, `keepRevision`. Shared-drive parameters, resource keys, pagination, 401 handling, shortcut resolution with `checkShortcut`.
   - Done when: unit tests pass against mocked responses.
3. **File navigator and file operations.** Home with Recent, vaults and roots; four roots including Shortcuts; shortcut following; drill-down list with breadcrumbs, rebuilt from parents when needed; hidden dot-folders; natural sort; name search; responsive layout. Create with a name prompt, rename, move and trash, with the vault warning.
   - Done when: any .md file in My Drive, a shared drive, a vault or behind a shortcut can be reached on desktop and phone, and files can be created, renamed, moved and trashed.
4. **Viewer and editor.** Viewer by default: GitHub-style rendering, sanitized HTML, front matter, relative links and images, tappable checkboxes, read-only states, last-modified line. CodeMirror 6 editor with light live styling, Cmd/Ctrl+click on links, list continuation and search; side by side or toggle. Dirty state, Save and Cmd/Ctrl+S, local copy and restore, conflict view, kept pre-edit revision, leave-page warning.
   - Done when: editing a file made by another tool and saving changes only the edited lines; CRLF and BOM files round-trip byte for byte; a file that is not valid UTF-8 opens read-only.
   - Carried over from milestones 2 and 3: one module holds the Drive queries' keys and fetchers, shared by the pages, the folder picker and the viewer; a size limit, 1 MB, is checked before a file's content is read; and a new empty file, which may have no head revision yet, skips keeping one.
5. **Obsidian vaults.** Vault detection and settings, line breaks, properties, callouts, highlights, comments, tags, block IDs, inline footnotes, internal links, image and note embeds.
   - Done when: a set of real notes from our vault renders like Obsidian's reading view, and every link and embed in them opens or shows the right file.
   - Carried over from milestone 3: link resolution and search say when Drive answers that its search was incomplete (`incompleteSearch`), rather than calling a link broken; and a note's vault is found even when a folder between the note and the vault is out of the user's reach.
6. **Routing and links.** `/edit?id=` with resource keys, paste a Drive link, `/open?state=` and `/new?state=` handlers.
   - Done when: each URL opens the right file after sign-in.
   - Carried over from milestone 3: breadcrumbs rebuilt from parents read each parent without its resource key, which the app does not know; check how Drive answers for a parent shared by link, and end the path cleanly there.
7. **Drive integration and Marketplace.** Manual console steps from the Open with section; deploy to `md.corp.edgeweave.tech` once the domain is verified.
   - Done when: right-click > Open with in Drive on the web opens the file in the app.
8. **Mobile polish.** Manifest and icons, safe areas, 16 px editor font, keyboard toolbar, Add to Home Screen hint, Android share target, smart punctuation check.
   - Done when: tested on a real iPhone (Safari and Home Screen) first, then on an Android phone (Chrome tab and installed app).
   - Carried over from milestone 3: the move picker opens at the folder the file really sits in, rather than along the path the user took.

## v2: Obsidian-style live preview

We will build our own live preview as a CodeMirror 6 extension, delivered in three stages: symbol hiding, then images, then tables.

**Decisions**

| Decision                                              | Choice                                                                     | Why                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Editor base                                           | CodeMirror 6, same as v1                                                   | The source text stays the single truth, so files are never reformatted; Obsidian uses the same approach |
| Rich-text editors (Tiptap, Milkdown, Lexical)         | Rejected                                                                   | They rebuild markdown on save and reformat files made by other tools                                    |
| Typora-style editors (Vditor instant rendering, Muya) | Rejected                                                                   | Same re-generation risk; weaker mobile support                                                          |
| Existing live-preview packages                        | Not used as dependencies, not copied                                       | We own the core of the editing experience; packages are read as a reference only                        |
| Implementation                                        | Our own extension on `@codemirror/lang-markdown` syntax tree + decorations | Builds directly on the v1 light styling                                                                 |

**Stages**

1. **Symbol hiding.** Hide `**`, `_`, `#`, ```, `~~` and link syntax `[text](url)` on every line except the one with the cursor. Headings, emphasis, links, lists and task checkboxes render formatted.
   - Done when: typing, selecting and deleting across formatted text works on a real iPhone.
2. **Images.** Show the image below its markdown line, loaded from Drive when the link points to a Drive file.
   - Done when: images show on iPhone and Android without shifting the text while scrolling.
3. **Tables.** Show a formatted table; tapping it reveals its raw markdown for editing.
   - Done when: editing a table on a phone never corrupts its rows.

If a stage proves too costly on phones, that element stays unhidden in the editor and the Preview toggle covers it.

**Design rules**

- **No jumping text.** Revealing or hiding symbols never changes line heights.
- **Hidden symbols stay intact.** Hidden ranges are atomic: the cursor skips them as one unit, and autocorrect or backspace cannot half-delete a `**`.
- **Three modes.** A setting switches between live preview, light styling (v1) and plain source. Source mode is always available as the fallback.
- **Byte-identical.** Decorations only change how text looks; the saved file changes only where the user typed.

**Testing**

Every stage is tested on a real iPhone first, then an Android phone, with our messiest real files. Check selection handles, dictation, autocorrect, and non-Latin keyboards (for example Japanese or Chinese input).

**Reference only (not dependencies):** [atomic-editor](https://github.com/kenforthewin/atomic-editor), [codemirror-live-markdown](https://github.com/blueberrycongee/codemirror-live-markdown).

## Open questions

- [x] Token backend or not: no backend, since sign-in passed the milestone 1 test on a real iPhone (see Tokens).
- [ ] Which icon does DriveMD get? The Drive UI integration needs it at milestone 7, and the Home Screen at milestone 8.
- [ ] Do the Drive iOS and Android apps show web apps under Open with? To check on real phones, for example with a web app already integrated with Drive in our domain, such as diagrams.net.

## Sources

- [Google: configure the OAuth consent screen (Marketplace)](https://developers.google.com/gsuite/marketplace/configure-oauth-consent-screen)
- [Google: OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Google: configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk)
- [Obsidian: Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown)
- [Obsidian: Basic formatting syntax](https://obsidian.md/help/syntax)
- [Obsidian: Callouts](https://obsidian.md/help/callouts)
- [Obsidian: Internal links](https://obsidian.md/help/links)
- [Obsidian: Embed files](https://obsidian.md/help/embeds)
- [Obsidian: Properties](https://obsidian.md/help/properties)
