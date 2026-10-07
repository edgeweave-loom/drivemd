# Drive Markdown Editor — Product Spec

Sep 27, 2026 · @gmasse

This file is the source of truth for the spec. It replaces the Claude Docs version it was exported from.

## Summary

We are building **DriveMD**, a web app to browse, view and edit Markdown (.md) files stored in our Google Drive, on desktop and on phones: iPhone first, Android too. It is for people in our Google Workspace organization only, and it must work on files created by other software. Some of these files live in Obsidian vaults stored in Drive; inside a vault, the app follows Obsidian's syntax and conventions.

The recommended approach is a static single-page app (Vite + React + TypeScript). It signs in with Google Identity Services, calls the Drive REST API v3 directly, edits with CodeMirror 6 and renders with react-markdown. The app has no backend: sign-in passed the milestone 1 test on a real iPhone, so v1 needs no token backend (see Tokens). Users reach files through a built-in file navigator, and on desktop also through Drive's own **Open with** menu, via a private Google Workspace Marketplace listing.

DriveMD is open source, under the GNU Affero General Public License, version 3 or later, so that other Google Workspace organizations can run it, and so that a modified version served to users stays open. This spec describes Edgeweave's own deployment, for Edgeweave's organization; the README explains how another organization runs its own.

## Users, platforms and scope

Users are employees signed in with an account in our Workspace organization. Accounts outside the organization cannot sign in. Most users are technical and comfortable with Markdown syntax.

The interface is in English and follows the system's light or dark theme.

**Platforms**

- Desktop browsers: Chrome, Safari, Edge, Firefox
- iPhone (priority): Safari, in a normal tab or saved to the Home Screen
- Android: Chrome, in a normal tab or installed as an app
- Tablets: the wide layout, adapted to their width (see Mobile requirements)

**In scope for v1**

- Browse My Drive, Shared drives and Shared with me, with notes that have unsaved changes, recent files and Obsidian vaults on Home
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

1. **Sign-in.** Users sign in with their Google account. Only accounts in our Workspace organization are accepted. The sign-in screen, and the account's menu once signed in (see Interface redesign), link to the about page, `/about.html`, which says what DriveMD reads, changes and keeps on the device, its terms of use, where to report a problem (the repository's GitHub issues), where its source code is, as the AGPL asks of a modified version served to users, and the licenses of its icons and fonts, as the Apache License asks of the Material Symbols in its pages and the SIL Open Font License of Google Sans Flex and Google Sans Code, whose texts the repository holds in `LICENSES/`. It is a page of its own, without script, readable without signing in.
2. **Home.** After sign-in, the app opens on Home, which shows in order:
   - **Unsaved changes:** the notes whose unsaved changes the device keeps for the signed-in account (see Save), the latest first, each with when they were kept; shown only when there are some, and never behind **Continue**, before Google has given the tab a token for the account. The list reads the device afresh each time Home shows, with or without a connection, and names each note as it was when its changes were kept until Drive gives its current name. A tap opens the note, which offers the changes back. A note that no longer opens there (deleted, no longer shared, in the trash, not downloadable, over 1 MB, or no longer named as a Markdown file) says why instead, and offers **Discard**, once the user confirms, since its page cannot. Home decides from Drive's answer since it showed, never from its cache.
   - **Recent:** the Markdown files the user opened most recently, newest first. The list comes from Drive's `viewedByMeTime`, which the app sets when it opens a file, so it is the same on every device. It keeps the Markdown files among the 100 files with content the user viewed last. Drive accepts it even for files the user can only view, and shows the new time a few seconds later (checked live).
   - **Vaults:** the Obsidian vaults found in Drive (see Obsidian vaults).
   - **Roots:** My Drive, Shortcuts, Shared drives and Shared with me.
   - On a wide screen, the vaults and the roots are in the navigation drawer beside Home instead (see Interface redesign).
3. **File navigator.** Shows four roots: My Drive, Shortcuts, Shared drives and Shared with me.
   - Lists folders, Markdown files (.md, .markdown) and Drive shortcuts that point to a folder or a Markdown file. Folders and folder shortcuts come first, then files, each sorted by name in natural order (`file2` before `file10`).
   - Folders and files whose name starts with a dot, such as `.obsidian` and `.trash`, are hidden.
   - Shortcuts work like the real thing: tapping a folder shortcut opens the target folder, tapping a file shortcut opens the target file. A small badge marks them as shortcuts.
   - The **Shared drives** root lists the shared drives the user is a member of, except those they hid in Drive, as Drive itself does.
   - The **Shortcuts** root lists the shortcuts the user owns, that is the ones they created outside shared drives, wherever they sit, for one-tap access. Shortcuts in shared drives are left out: the whole team creates them, and Drive cannot tell which ones the user made.
   - A broken shortcut (target deleted, in the trash, or no access) is shown greyed out with a short reason.
   - Breadcrumbs show the path the user took, including through a shortcut. When there is no such path (deep link, **Open with**, reloaded folder URL), they are rebuilt from the parents up to My Drive, the shared drive or Shared with me; a parent the user cannot access ends the path.
   - Every page has its own URL: `/` for Home; `/my-drive`, `/shortcuts`, `/shared-drives` and `/shared-with-me` for the roots; `/folder/<id>` for a folder; `/search?q=<text>` for search; and `/edit?id=<id>` for a file, with `#<part>` to open it at a heading or a block, unfolding the callouts around it. The about page, `/about.html`, is a page of its own, outside the app (see Sign-in). Drive's **Open with** and **New** open `/open?state=…` and `/new?state=…` (see Handling the redirect), and Android's share sheet opens `/share?…` (see Android specifics). `resourcekey=<key>` is added when the item needs one. The browser's history keeps the path the user took, so Back and a reload keep the breadcrumbs. A URL whose ID or key is not shaped like Drive's opens nothing.
   - A search box finds Markdown files by name across all drives. Drive matches the start of words, not any substring: "plan" finds `planning.md` but not `myplan.md`, and every word typed must match. It ignores case, accented letters included (checked live), where Drive's exact name match ignores the case of ASCII letters only (see Link resolution). It shows the Markdown files among the first 100 matches, the most recently modified first, and says so when Drive answers that it left some drives out of the search (`incompleteSearch`). A Drive link pasted in it opens instead (see Deep links).
4. **Viewer.** Files open in the viewer by default, on every screen, with an **Edit** button.
   - Renders Markdown with GitHub-style extras: tables, task lists, strikethrough, autolinks and footnotes. Code blocks are syntax-highlighted. Math and Mermaid are not rendered; they show as written.
   - Raw HTML is rendered and sanitized as GitHub does, and HTML comments are hidden. Every id in a note gets GitHub's `user-content-` prefix, so that none can stand for one of the app's own, and headings get ids, so that `#heading` links scroll to them. YAML front matter shows as a properties table at the top instead of rendering as a heading; front matter that holds no properties, such as a list or YAML that does not parse, shows as written.
   - Relative links and images (`../other.md`, `img/a.png`) resolve against the file's folder in Drive. Links to Markdown files and folders open in the app, a note at the heading its `#` names (`plan.md#next-steps`, as GitHub names headings); links to other files open them in Google Drive, and other links, in a new tab. A relative link that leads to nothing in Drive is shown faded. A path is read as written first (`a/../b` is `b`), and a file wins over a shortcut of the same name. Relative links are looked up only as they come near the screen, so that a note with thousands of them asks Drive only for those the user scrolls to. Images stored in Drive are fetched with the user's token, as they come near the screen, and shown through object URLs (`blob:`), the only images the security policy allows besides the app's own; an image over 10 MB, one the user may not download, one the browser cannot decode, or any file but a PNG, JPEG, GIF, WebP, AVIF or BMP image is a link to Google Drive instead. SVG is left out, since it can hold script. Images on other sites are not loaded: each shows as a link that opens it in a new tab, so that a note cannot make the app call another server.
   - Inside a vault, Obsidian syntax renders as described in Obsidian vaults.
   - Task checkboxes are tappable. Toggling one changes only `[ ]` to `[x]` (or back) in the source and marks the file as unsaved, like any other edit.
   - The header shows who last modified the file and when.
   - Files the user cannot edit (view or comment access, locked file) open read-only with a badge giving the reason, and **Edit** is hidden. Files the user cannot download show that reason instead of their content.
   - Files over 1 MB are not read, so that rendering never stalls a phone: the page gives their size and a link to open them in Google Drive.
5. **Editor.** Edits the raw Markdown source with CodeMirror 6 and Markdown syntax highlighting.
   - **Edit** opens the editor and **Done** closes it, keeping any unsaved edits. Wide screens and tablets show the editor and preview side by side. Phones switch between the source and the preview.
   - The editor holds the text while it shows: a task tapped in the preview reaches it as one edit, which undo reverts. The page holds to the revision the editor opened with, across the user's own saves, and shows a newer one from Drive only after **Done** with nothing unsaved.
   - Whatever an edit inserts, typed, pasted, dropped, typed by an input method or put by a replacement, takes the file's own line break, and NUL characters and half characters are kept out, so that the saved bytes are the text shown.
   - The editor runs in a shadow root, where CodeMirror styles itself through constructed style sheets: elsewhere it adds `<style>` elements, which the security policy blocks, and the policy needs no `'unsafe-inline'` for styles. The app tells CodeMirror whether the system's theme is dark, as it changes, since CodeMirror cannot tell from the app's colors: its packages, such as the differences' `@codemirror/merge`, otherwise style themselves for a light theme.
   - **Light live styling (v1).** Headings shown larger, bold and italic styled, inline code and code blocks in monospace. Markdown symbols (`**`, `#`, `[]()`) are dimmed, never hidden, so cursor and selection behave normally on phones.
   - Front matter shows as YAML at the text's size, its keys and symbols dimmed like Markdown's, as YAML code blocks do. The editor finds it where the viewer's `remark-frontmatter` does: between two lines of three dashes, which spaces and tabs may follow, the first one being the note's first line, after any byte order mark. A note whose first fence never closes has no front matter, in the editor as in the viewer. `@codemirror/lang-yaml`'s own front matter is not used: it takes the rest of the note when no fence closes it, closes at a line of four dashes, and misses a fence that spaces follow.
   - A tap or click in the editor only places the cursor; checkboxes and links react in the viewer and the preview. On desktop, Cmd/Ctrl+click opens a link from the editor, as in Obsidian: an inline link, an autolink or a bare web address, where a tap in the preview would lead.
   - Enter continues lists and task lists.
   - A search panel finds text in the file. The browser's own find misses text that CodeMirror has not drawn, since it renders only the visible part of the file.
   - **Full Obsidian-style live preview (v2).** Symbols hidden except on the line being edited, and images and tables rendered in the editor. A setting switches between full live preview, light styling and plain source. Details in the v2 live preview section.
   - All modes are CodeMirror 6 decorations over the same source text, so files stay byte-identical and v2 builds on v1 without rework.
6. **Save.** Explicit Save button plus Cmd/Ctrl+S, from the editor or the viewer; there is no autosave, and Cmd/Ctrl+S never saves the page itself. The Save button shows whenever the file has unsaved changes, in the viewer too.
   - Unsaved text is kept on the device (IndexedDB) as the user types, half a second after the last change and at once when the page hides or goes, so it survives a reload, a crash or iOS closing the app. It is kept per account, with the revision it was edited from and the note's name and resource key, so that Home lists it at once and opens it even when shared by link. Reopening the file offers to restore it or discard it, with or without a connection, and editing waits for the answer; restoring writes nothing, and the next save of a note that changed in Drive since leads to the conflict choice. The device forgets the text once nothing is unsaved while the page shows, after a save, edits undone by hand or Drive's version kept after a conflict, when a copy is saved after one, and when the note opens with the very text the device holds. A device that keeps nothing still lets the user edit.
   - The app writes only when the bytes actually changed.
   - Before writing, it checks that nobody else changed the file since it was opened (conflict check). If someone did, it shows the differences between the Drive version and the user's version, and the user chooses: keep the Drive version, overwrite it with their version, or save their version as a copy named `<name> (conflict).md` in the same folder. The differences show the user's version in one view that reads on a phone: what it removes from Drive's struck through, what it adds underlined, each on a color of its own. Keeping Drive's version asks first, since the user's changes then go. Overwriting keeps Drive's revision in the file's history; the copy opens once saved, and is offered only where the file's folder is known. Restoring a local copy of a file that changed in Drive leads to the same choice.
   - Before the first write of an editing session, it marks the file's current revision as kept forever, so the pre-edit version survives Drive's revision cleanup. That revision stays in the file's version history until someone deletes it there, even when it holds text the user then removes on purpose, such as a pasted secret.
   - It warns before leaving a page with unsaved changes: the browser does for a reload, a closed tab or another site, and the app asks before opening another of its pages, but not for the note's own address, as after a rename, nor once the user chose to go, as after trashing the note or saving a copy. iOS does not show the browser's warning reliably, and the browser's Back is not asked; there, the local copy is the safety net.
7. **File operations.**
   - **Create** a new .md file in the current folder. The app asks for the name first (prefilled with `Untitled`, `.md` added) and never creates an unnamed file. **New** is offered only in a folder where the user can add files.
   - **Rename**, **Move** (with a folder picker that opens at the folder the file sits in, below the path its parents give, as breadcrumbs rebuilt from them, whatever led to the file: a shortcut, a search or a link) and **Move to trash** (after a confirmation; the file stays restorable from Drive's trash). Each action is hidden when the user's rights do not allow it.
   - Inside a vault, renaming or moving warns that links pointing to the file will not be updated: Obsidian updates them only when it renames the file itself. No other file is changed.
8. **Deep links.** Every file has its own URL, `/edit?id=FILE_ID`, plus `&resourcekey=KEY` when the file has a resource key. A Drive link pasted in the search box opens its file or folder instead of searching, with the link's resource key: the links Drive and Google's documents give (`/file/d/<id>`, `/drive/folders/<id>`, `/document/d/<id>` and the like, `/open?id=` and `/uc?id=`, with or without the `/u/<n>` that picks one of several signed-in accounts or the `/a/<domain>` of older links). The file's page then says it does not open Google's documents, and leads to the folder that an `/open?id=` link names, since such a link does not say which it is. A document published to the web (`/d/e/<code>`) names no item. An address of the app opens its page.
9. **Open with.** Opening a .md file from Drive on the web, on a computer or in a phone's browser, with **Open with** loads it in the app, and so does a double click once the user makes DriveMD the default app in Drive's settings (Manage apps); Google Docs, which now edits .md files itself, opens them otherwise. Drive's **New** does not offer DriveMD: for a Markdown app, Drive creates the file itself, named as Docs names its documents, and opens it in Docs, without calling the app's New URL (checked on 2026-10-05). Notes are created with DriveMD's own **New**, and its `/new?state=…` page, which asks for a name and creates the file in the folder the state names, stays for the day Drive calls it.

**Shortcut implementation notes.** Shortcuts have MIME type `application/vnd.google-apps.shortcut`. Every listing requests `shortcutDetails(targetId,targetMimeType,targetResourceKey)` in its `fields`. The Shortcuts root queries `mimeType='application/vnd.google-apps.shortcut' and 'me' in owners and trashed=false`. Opening or listing always uses `targetId`, never the shortcut's own ID. Folder shortcuts are recognized by `targetMimeType`; file shortcuts by a name ending in .md or .markdown. A 404 on the target, or a target with `trashed=true`, marks the shortcut as broken. Checking targets costs one request per shortcut, so show the list at once, check the targets in parallel, and grey out each broken shortcut as its check returns; a check that fails leaves the shortcut as it is.

**Permission notes.** Request `capabilities` and `contentRestrictions` with every file and folder, and hide or disable whatever the user cannot do.

**Resource key notes.** Some files shared by link need a resource key. Keep it from listings, shortcut targets (`targetResourceKey`), pasted links (`resourcekey=`) and the **Open with** state, and send it in the `X-Goog-Drive-Resource-Keys` header on every call for that file.

## Obsidian vaults

A vault is a folder that contains a `.obsidian` folder. Inside a vault, the app follows Obsidian's rules; everywhere else, it follows GitHub's.

- **Finding vaults.** One query across all drives finds them: `name='.obsidian' and mimeType='application/vnd.google-apps.folder' and trashed=false`. The parents of the results are the vault roots, listed on Home.
- **A note's vault.** A note belongs to the nearest vault above it, among the folders it sits in. The query that finds vaults gives each `.obsidian` folder with the folder it sits in, which is enough here: the app reads no vault's folder, and reads the note's folders only when Drive holds a vault. The note shows once the app knows, so that it never changes as the answer comes; when Drive fails to say, the note shows as Markdown, without Obsidian's syntax, and the page says so. Drive names no folder the user cannot reach (checked live), so a note below a folder out of the user's reach cannot be known to sit in a vault above it: it shows as Markdown, as a note outside any vault does.
- **Vault settings.** The app reads `.obsidian/app.json`, listing the `.obsidian` folder only; a missing key means Obsidian's default, and so does a file that is not JSON, holds over 100 KB, or that Drive fails to send.
- **Line breaks.** By default, Obsidian shows a single line break as a line break, where GitHub joins the two lines. The viewer does the same, unless the vault's `strictLineBreaks` setting is on.
- **Sanitizing.** A note in a vault is sanitized by GitHub's rules too, which also let through what Obsidian's syntax renders to: the callout and embed classes, the callout types, highlights (`mark`), the tag class and the target of an internal link or an embed (`data-wikilink` on a link, `data-embed` on an image or a block), which raw HTML may then use as well: the classes only style, and a target only leads where `[[…]]` or `![[…]]` would, a link without text asking Drive nothing.
- **Rendered in v1:**
  - Properties (YAML front matter), as a table at the top of the note.
  - Checked tasks struck through, as Obsidian's theme shows them.
  - Callouts `> [!note] Title`, foldable with `[!faq]-` (collapsed) or `[!faq]+` (expanded), and nested. A callout without a title is titled by its type as written (`[!tldr]` gives "Tldr"), and each type shows in the color Obsidian's light or dark theme gives it, without its icon. A marker the note escapes (`\[!note]`) shows as written. Types and aliases: note; abstract (summary, tldr); info; todo; tip (hint, important); success (check, done); question (help, faq); warning (caution, attention); failure (fail, missing); danger (error); bug; example; quote (cite). Unknown types render like note. GitHub alerts use the same syntax.
  - Highlights `==text==`; comments `%%text%%`, hidden from a `%%` to the next one in the note's order, whatever blocks they span, and to the end of the note when nothing closes them, a block they hide as a whole going too; tags `#tag` and `#parent/child`, shown as labels without search; block IDs `^id`, hidden, which name the block they end, after a space, or the block before when on a line of their own, but never a heading, which links name by its text; inline footnotes `^[text]`, numbered in their turn among the note's other footnotes. A mark the note escapes (`\#tag`, `\==`) shows as written.
  - Internal links `[[Note]]`, `[[Note|text]]`, `[[Note#Heading]]` and `[[Note#^block]]`, `[[#Heading]]` within the note, `[[Note#Heading#Subheading]]` for a heading under another, and Markdown links to notes such as `[text](My%20note.md)`. A link without its own text shows as Obsidian shows it, `Note > Heading`. A tap opens the note in the app at that heading or block, a link to another file opens it in Google Drive, and the editor's Cmd/Ctrl+click follows a Markdown link the same way. A link that resolves to nothing is shown faded; when Drive answers that its search left some drives out, the link is not faded but says it may lead to a note there.
  - Image embeds `![[image.png]]`, with an optional width `![[image.png|300]]` or size `![[image.png|300x200]]`, and text before the size (`![[image.png|A cat|300]]`), fetched from Drive as relative images are. An embed is found as an internal link is, and so is a Markdown image (`![](image.png)`) in a vault.
  - Note embeds `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]`, rendered inline, as they come near the screen, under a link to the note, without its properties: a heading's section runs to the next heading of its level or above, found by the heading's text (underlined headings too, none in code, properties or comments), and a block is the paragraph, the list item with the items under it, or the block before the line its `^id` ends. Embeds nest at most 3 levels deep, and a note shows ten embedded notes at most; a note that embeds itself, directly or through others, is not expanded again. Past those, an embed is a link, as is one within text, or one of a note DriveMD cannot show (over 1 MB, not UTF-8, not downloadable). A note an embed shows keeps no ids, which the note around it already gives, and its links to its own parts open its page there; its tasks are checked on its own page.
- **Shown as a plain link:** PDF, audio, video and canvas embeds.
- **Shown as written:** math, Mermaid and plugin syntax (Dataview, Tasks, Templater, Bases).
- **Link resolution.** Obsidian resolves `[[Note]]` by file name anywhere in the vault, not by path. The app looks a name up in the note's folder first, then by exact name across Drive (`name='Note.md'`), keeping matches inside the vault; when several match, it prefers the shortest path, then the name written in the same case, then the first by path. Obsidian documents no choice between two notes of the same name at the same depth: it took the other one in the test vault, and kept it once the first was changed last (checked by hand), so it follows neither path nor last change; it writes the path itself in a link it makes to such a name (`[[A/Note]]`). DriveMD keeps its own choice, which never changes, rather than guess. Drive matches a name whatever the case of its ASCII letters but not of others (checked live), so the app also asks for the name in small letters, in capitals and with capital initials, so that `[[été]]` finds `Été.md`. Which matches sit in the vault comes from the vault's folders, each listed once as the navigator lists it, four at a time, and kept 5 minutes, never from a call per match: a search over several folders at once would take fewer calls, but leaves out what other people made (checked live); folders whose name starts with a dot, such as `.trash`, are left out, as Obsidian leaves them out. A link with a path (`[[folder/Note]]`, `[text](folder/Note.md)`) resolves relative to the note first, then from the vault root, then as the end of a file's path anywhere in the vault, as Obsidian's shortest-path links need; a path never leads out of the vault. A Markdown link without a path is a name, as in Obsidian. A name without an extension stands for a note, `.md` added, and one with a dot is tried as written first, near the note before anywhere else (`[[image.png]]`, then `[[v1.2 notes]]` as `v1.2 notes.md`). Names and paths compare whatever their case, the same case first. Folders, shortcuts and Google's own documents are no link's target.

## Recommended tech stack

The app is a static page hosted on our own HTTPS domain; the browser talks to Google directly, so milestone 1 needs no server.

```text
Drive on the web: Open with, New ──┐
Home and file navigator ───────────┼──> Static app ──┬──> Google Identity Services: access token
Deep link or pasted Drive link ────┘    (browser)    └──> Drive REST API v3: list, read, write files
```

All three entry points load the same app, which gets a token from Google sign-in and then reads and writes files through the Drive API. The milestone 1 iPhone test showed that no token backend is needed; should one become necessary, it would handle sign-in only, and file content would still go straight between the browser and Drive.

**Domains.** Production is `md.corp.edgeweave.tech` and staging is `md-staging.corp.edgeweave.tech`, both in a dedicated `corp.edgeweave.tech` DNS zone that must exist before milestone 1. Staging is a sibling of production, not a subdomain of it, so a cookie set by production never reaches staging. Both are Firebase Hosting sites of one Google Cloud project, which also holds the OAuth client, the Drive UI integration and the Marketplace listing, so that each new app does not cost the organization a project per environment. CI deploys every push to `dev` to staging and every push to `main` to production, authenticated through Workload Identity Federation rather than a service account key. Firebase grants Hosting rights on a whole project, not on a site, so the account that deploys staging can deploy production too.

| Concern         | Choice                                                 | Notes                                                                                                                        |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Build and UI    | Vite + React + TypeScript                              | Static build, deployable to any HTTPS host                                                                                   |
| Sign-in         | Google Identity Services (token model)                 | `google.accounts.oauth2.initTokenClient`                                                                                     |
| Drive access    | Drive REST API v3 with plain `fetch`                   | Small typed wrapper; no `gapi` client needed                                                                                 |
| Editor          | CodeMirror 6 + `@codemirror/lang-markdown`             | Add `@codemirror/language-data` to highlight fenced code                                                                     |
| Preview         | `react-markdown` + `remark-gfm` + `remark-frontmatter` | `rehype-raw` + `rehype-sanitize` for HTML; `rehype-highlight` or Shiki for code                                              |
| Obsidian syntax | remark plugins                                         | Maintained plugins where one fits, such as `remark-breaks`; our own for link resolution and embeds, which need Drive lookups |
| Conflict view   | `@codemirror/merge`                                    | Shows the Drive version against the user's                                                                                   |
| Local copy      | IndexedDB                                              | Unsaved text per account and note, with the note's name and resource key                                                     |
| Navigator       | Custom drill-down list                                 | Optional `react-arborist` tree on wide screens                                                                               |
| Data caching    | TanStack Query                                         | Caches Drive's answers, one cache per account; retries only what may pass later                                              |
| Hosting         | Firebase Hosting                                       | Production and staging domains above                                                                                         |

## Google auth, scopes and Workspace setup

Set the OAuth app's audience to **Internal**: apps used only inside our Workspace organization can use sensitive and restricted scopes without Google's verification review ([Google: configure the OAuth consent screen](https://developers.google.com/gsuite/marketplace/configure-oauth-consent-screen)). This lets us use the full `drive` scope, which is needed to edit files created by other software.

**Google Cloud setup**

@gmasse, a Workspace admin, creates the project, handles the admin console and installs the Marketplace listing.

1. Create the Google Cloud project inside our Workspace organization, not under a personal Gmail account.
2. Enable the Google Drive API.
3. In Google Auth Platform, set Audience to **Internal**, and the app name to **DriveMD** under Branding, as the Marketplace listing names it.
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
- The token is kept for the tab, in memory and in `sessionStorage`: a reload keeps the session, while a new tab or an app launch asks for **Continue**. It counts as expired once 5 minutes or less remain. The account's email stays on the device (`localStorage`) to offer **Continue** and to pass as `login_hint`, except in a tab that Drive opened without a token, which signs in afresh (see Handling the redirect). **Sign out** forgets both on the device, in every open tab, and does not revoke the grant, which would sign the user out on every device. It also discards the account's unsaved changes kept on the device (see Save), after saying how many notes have some, so that nothing of the account stays behind; no tab keeps them once the account is signed out.
- On a 401, show **Continue**, then retry the call once with the new token. A save checks again for someone else's change before it retries, since the new token may have taken a while to come. Never drop the user's unsaved text when a token renewal fails.
- GIS can report its window as closed while it is still open, when the page in it cuts the window off from the app. The app therefore keeps waiting after that report and lets the next tap start a new request, instead of dropping a token that arrives later.
- **Decided at the end of milestone 1: no token backend.** Sign-in and renewal worked on a real iPhone, in a Safari tab and from the Home Screen, so the popup token model stays. If that changes, the fallback is a small token backend on Cloud Run: redirect sign-in with the authorization-code flow, the refresh token kept encrypted on the server, and short-lived access tokens handed to the app, while file content still goes straight between the browser and Drive. All sign-in code stays in one module (`src/auth.ts`) so that change would touch nothing else.

**Admin console**

As Workspace admin, @gmasse checks **Security > API Controls**. Admins can block any OAuth app, including internal ones; internal apps are trusted when "Trust internal, domain-owned apps" is on ([Google: production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)).

**Shared drives**

Every call on files must pass `supportsAllDrives=true`; the calls on shared drives and revisions take no such parameter. Listing a folder by its parent needs no `corpora`, even in a shared drive, where it shows every member's files (checked live). Listings also need `includeItemsFromAllDrives=true`, and cross-drive search uses `corpora=allDrives`.

## Drive "Open with" integration via private Marketplace

A private Google Workspace Marketplace listing puts the app in Drive's **Open with** menu for .md files, installed for the whole organization by our admin. The setup follows [Google: configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk) and [Google: create a store listing](https://developers.google.com/workspace/marketplace/create-listing). The integration and the listing belong to the project that holds the OAuth client and both sites (see Domains). A project has one Open URL and one New URL, so Drive opens production only; staging is checked at the addresses Drive would open, `/open?state=…` and `/new?state=…`, as `npm run live-check:ui` does.

**Domain ownership.** Google requires owning the domain of the Open and New URLs before listing the app. A Domain property for `corp.edgeweave.tech` in Google Search Console, verified by a DNS TXT record in that zone, covers both subdomains ([Google: verify your site ownership](https://support.google.com/webmasters/answer/9008080)). Verify it with an account that owns the project, as Google's other domain checks ask.

**Drive UI integration (Cloud console > Google Drive API > Drive UI integration)**

1. Name the application **DriveMD** and give it the short and long descriptions below, which Drive shows among the user's apps.
2. Upload the app icons, PNG images with a transparent background: `docs/listing/icon-16.png`, `icon-32.png`, `icon-64.png`, `icon-128.png` and `icon-256.png`, drawn from `public/icon.svg`. Drive may take 24 hours to show them.
3. Set the **Open URL** to `https://md.corp.edgeweave.tech/open`. Leave the automatic OAuth consent screen unticked: Google deprecated it, and the app starts every authorization itself.
4. Tick the support of mobile browsers, since DriveMD works in them: Drive in Safari on an iPhone opens it (checked). Leave the opening of several files in one instance unticked: a page shows one note, and Drive would send them all for the app to open the first.
5. Set the default MIME types `text/markdown` and `text/x-markdown`, which .md files carry in Drive (see Risks), so that Drive offers DriveMD first for them, the default file extension `md`, and the secondary file extension `markdown`.
6. Leave **Creating files** unticked. Drive does not call the New URL for a Markdown app (see requirement 9): ticked, Drive's **New** > DriveMD makes an empty `Untitled document.md`, in the user's language, that Docs then fails to open. Were Drive to call it, the New URL is `https://md.corp.edgeweave.tech/new`, with **Document name** left empty, which Google no longer uses.
7. Leave **Importing** unticked, since the app does not open Google's documents, and tick **Shared drives support**.

**Marketplace listing (Cloud console > Google Workspace Marketplace SDK)**

1. Enable the Marketplace SDK in the same project, whose billing is enabled, as Google may require.
2. In the app configuration, choose **Private** visibility, which can never change once saved, and **Admin Only Install**; tick the **Drive app** integration only; list the scopes the app requests, `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/drive.install`; and give the developer's name, website and email, and its trader status, which the admin decides: DriveMD is not sold to anyone.
3. In the store listing, give the name **DriveMD**, as on the OAuth consent screen, the descriptions below and a Productivity category; upload `docs/listing/icon-32.png`, `icon-48.png`, `icon-96.png` and `icon-128.png`, as the listing asks for all four, the card banner `docs/listing/banner.png` (220 × 140) and the screenshot `docs/listing/screenshot.png` (1280 × 800); and link the terms of service, privacy policy and support to the about page's parts: `https://md.corp.edgeweave.tech/about.html#terms`, `#privacy` and `#support`.
4. Publish. A private listing is published at once, without Google's review, among the organization's internal apps.
5. As a super administrator, install it from the Admin console (Apps > Google Workspace Marketplace apps > Apps list > Install app > Admin install), for a group or an organizational unit first to try it, then for everyone. Google says the change takes up to 24 hours.

**Descriptions**

- Short (200 characters at most): "Browse, view and edit the Markdown files in your Google Drive, Obsidian vaults included, on a computer or a phone. DriveMD never changes a byte you did not edit."
- Long: "DriveMD opens the Markdown files in your Google Drive, renders them as GitHub does, or as Obsidian does inside a vault, and lets you edit their source and save them back. It keeps line breaks and encodings as they were, warns when someone else changed a file since you opened it, and keeps your unsaved text on your device. Open a .md file from Drive with Open with, or with a double click once DriveMD is your default app, or browse your drives in the app. DriveMD has no server of its own: your browser talks to Google Drive directly."

**Handling the redirect**

Drive opens our URL with a URL-encoded JSON `state` parameter. The app decodes it, gets a token (without a backend, after a tap on **Sign in**, as below), then loads the file or asks for the new one's name.

Drive's templates for them, which its `apps.get` gives with `fields=*` (checked on 2026-10-05), fill in the item's IDs and keys, so that a key the item lacks comes as an empty string:

```json
// Open URL
{ "ids": ["{ids}"], "exportIds": ["{exportIds}"], "action": "open", "userId": "USER_ID", "resourceKeys": {resourceKeys} }
// New URL
{ "folderId": "{folderId}", "action": "create", "userId": "USER_ID", "folderResourceKey": "{folderResourceKey}" }
```

For `open`, redirect to `/edit?id=<first id>`, adding its resource key from `resourceKeys` when there is one, before the app starts, so that a reload or a copied address names the file; `exportIds`, which Drive sends for Google's own documents, open nothing, since the app is listed for Markdown files only. For `create`, the page shows the folder's path and, once the tab has signed in and Drive says the user may add files there, asks for the file name (prefilled with `Untitled`), saying which folder it goes in, since a link chose it, then creates the file in `folderId` (My Drive when Drive names none), with `folderResourceKey`, and gives way to its `/edit` URL, so that Back does not ask again; cancelling gives way to the folder. A folder the user cannot add files to, or an item that is no folder, says so. A state not shaped as Drive writes it, or with an ID or a key not shaped like Drive's, opens nothing; an empty key counts as none.

`userId` is the Google profile ID of the account Drive acted as, and Google asks apps to sign in as that account when it is not the one signed in. The app cannot compare them: Google gives an account's profile ID only to an app granted the `openid` scope (checked live: `tokeninfo` names no `sub` for the app's token). Drive opens these addresses in a new tab, which has no token yet: there, instead of **Continue** as the account the device remembers, the app shows **Sign in**, whose request passes `userId` as `login_hint` with Google's account chooser, so that the user picks the account, starting from Drive's, rather than a link picking it for them, silently or behind a button that names another account. Google shows its chooser for that request (checked on 2026-10-05). The account picked replaces the one the device remembers, if another, as any sign-in does. A tab that already has a token, such as one where the address was pasted, acts as its own account, and a reload of Open with's tab before signing in forgets Drive's account, since the file's address no longer holds it.

**Phone limit**

Google's Drive help, on its iPhone and Android pages too, sends users to drive.google.com on a computer to use Drive apps: "To use Google Drive apps, download apps from the Google Workspace Marketplace and go to drive.google.com on your computer" ([Google: use Google Drive apps](https://support.google.com/drive/answer/2500820?co=GENIE.Platform%3DiOS)). On an iPhone (checked on 2026-10-05), the Drive app neither opens a .md file, an "unsupported file type", nor lists DriveMD under **Open with**, while Drive in Safari opens it in DriveMD, since the integration supports mobile browsers. On phones, the entry points are the app's own navigator, deep links, and Drive in the browser.

## Mobile requirements (iPhone first, Android too)

iPhone is the priority and Android must work too. On both, the app runs in the phone's browser, can be added to the home screen, and the built-in navigator is the main way in.

- **Home Screen app.** A web app manifest, `public/manifest.webmanifest`, and `apple-mobile-web-app-capable`. The app's name, also shown under its icon, is **DriveMD**. The app opens on Home (`/`) in a window of its own (`standalone`), whatever page of the app it was added from; the about page, outside the app, links no manifest. Its icons are `public/icon.svg`, with its PNGs at 192 and 512 px, for install dialogs and launchers that show an icon as drawn, and `public/icon-maskable.svg`, the same mark on a plate that fills the square, for those that cut icons to their own shape: iOS rounds the corners of its `apple-touch-icon.png`, at 180 px and opaque, since iOS fills transparent pixels with black, and Android cuts `icon-maskable-512.png` to its launcher's shape, keeping at least the middle circle, four fifths of the side across, where the mark sits. The browser's bars and the installed app's take the page's background once it loads (`theme-color`), in the light or dark theme; before that, Android's launch screen takes the manifest's one colour, the light theme's background. Respect notch and home-bar areas with `env(safe-area-inset-*)`. Safari never offers to install a web app, so show a one-time hint on iPhone explaining **Share > Add to Home Screen**.
- **Sign-in.** Start the GIS popup only from a tap, or Safari blocks it. Sign-in passed the milestone 1 test in Home Screen (standalone) mode, so no token backend is needed (see Tokens).
- **Layout.**
  - Phone layout: a drill-down folder list with breadcrumbs, and an Edit / Preview toggle. It applies under 768 px wide, and on touch screens less than 500 px tall, so an iPhone in landscape (844 px wide or more) keeps it.
  - Wide layout: tree or list on the left, then the viewer, or the editor and preview side by side. Between 768 and 1024 px wide, as on an iPad in portrait, the tree folds into a drawer so the editor and preview keep enough room.
- **Editor.** Editor font size at least 16 px, so Safari does not zoom in on focus.
- **Keyboard toolbar (required on phones).** Pinned above the keyboard with the `visualViewport` API: undo, redo, heading, bold, list, checkbox, link, indent, outdent (the iPhone keyboard has no Tab key) and search in the file. It shows on touch screens (`pointer: coarse`), phones and tablets alike, while the editor has the focus, at the bottom of the screen when no on-screen keyboard is up, and the editor keeps the cursor clear of it when it scrolls; with a mouse, the keyboard's own keys do instead. Its keys never take the focus, so that the keyboard stays up: each cancels the mouse event that would move the focus, but not the pointer event before it, since WebKit then drops the whole tap (checked in Playwright's WebKit). The row scrolls sideways when its 44 px keys do not fit. Each formatting button is one edit, which undo takes back alone, apart from what is typed right after it, and adds or removes only its own Markdown, never a line break. Blank lines in a selection are left as they are, and lines in a quote or a callout keep their `>`.
  - **Heading** makes the selected lines headings one level below the first line's, up to the third, then text again: `#`, `##`, `###`, none.
  - **Bold** wraps the selection in `**`, without the spaces at its ends, or takes the `**` away from the bold text that holds the selection or the cursor. With nothing selected, it adds `****` with the cursor inside, which a second tap takes away; at the end of the bold text typed there, a second tap steps out of it.
  - **List** puts a `- ` bullet on the selected lines, or takes it off, task box included, when every line has one; a numbered item takes a bullet instead.
  - **Checkbox** moves the selected lines on from the first line's state: text or a list item becomes an open task (`- [ ]`, keeping the item's marker), an open task a done one (`[x]`), and a done task a list item again.
  - **Link** makes the selection a link's text, `[text]()`, with the cursor where the address goes, or, when the selection is a web address, the link's address, `[](https://…)`, with the cursor where the text goes; with nothing selected, it adds `[]()` with the cursor in the brackets.
  - **Indent** nests the first selected line one level, after any `>`, as the editor's Markdown parser reads the list: a list item lines up with the text of the item before it, in its list or ending a list of another kind right before it, as CommonMark nests a list item, so 2 columns under `- ` or `- [ ] `, 3 under `1. `, 4 under `10. `, counted from the line's start, `>` included. A line that opens no list item, or the first item of a list, goes an indent unit further, two spaces. Where the list indents with tabs (the item before, the item that holds the list, or the first item nested in either), as Obsidian's do by default, the first line's indent becomes tabs alone, as many as reach that column, or the next tab stop when it opens no item or the first item, a space indent turning into tabs too, so that a note keeps one kind of indent; a tab in an item's text does not count. A numbered item takes the number 1, keeping its `.` or `)`, when the line just above it in its new item is paragraph text, which only a list starting at 1 may break into: `2. b` would otherwise run on as text. It keeps its number after a blank line, a heading, a fenced block or HTML, when Markdown already reads it as 1 (`01`), or when it joins the numbered list, with the same delimiter, that the item above ends with. That number is the only character other than spaces and tabs that a tap may change: Undo brings it back, while Outdent leaves the 1, since Markdown numbers a list from its first item. An item without text yet nests in the preview once it has some: until then, Markdown reads a bare bullet indented under a line as that line's underline, and a bare number as its text. **Outdent** starts from the first selected line that has an indent: a list item takes the indent, as written, of the item that holds it, and any other line, or an item that none holds, gives up an indent unit's worth of spaces, or a tab, never more, so that text in an item, or a fenced block, stays in it. Lines without an indent stay. The other selected lines keep their own indent as written, so that code in them keeps its bytes: Indent puts the first line's step, in its kind, before it, and Outdent takes as many columns of whitespace from its start, a tab only when the step reaches its end, never past their start. They keep their nesting, though a line whose indent has a tab after spaces may move a column or more less, or more, as its tab stops shift. Cmd/Ctrl+] and Cmd/Ctrl+[ do the same from a keyboard. **Find in note** opens the editor's search panel, whose field then has the focus, so the toolbar steps aside until the text has it again.
- **Smart punctuation.** iOS's smart punctuation, autocorrect and capitals would turn `"` into curly quotes and `--` into a dash, which breaks YAML and code, and rewrite the words of links and properties. The editor keeps them off, as CodeMirror sets them (`autocorrect`, `autocapitalize` and `spellcheck`), so that what is typed is what is saved: on a real iPhone, with English, French and both keyboards, quotes, apostrophes and `--` stay as typed, no word is corrected and no line takes a capital (checked on 2026-10-06). The editor should also keep two spaces typed after a word, which make Markdown's line break at a line's end, but an iPhone still turns them into a period and a space: CodeMirror undoes that period only in the form a Mac or Android inserts it, and how iOS changes the text is not known yet (issue #119). Until then, the iPhone's "." Shortcut can be turned off in its keyboard settings. The name asked by New and Rename stays as typed too, and the search box neither capitalizes nor corrects what is typed.
- **Opening files.** Support `/edit?id=FILE_ID` links and pasting a Drive file link, so a file can move between desktop and phone.
- **Touch.** No hover-only controls; tap targets at least 44 px.

**Android specifics**

- **Install.** The same web app manifest lets Chrome offer "Install app"; test both the tab and the installed app.
- **Back button.** Give each folder its own URL (for example `/folder/<id>`), so the Android back button steps back through folders instead of leaving the app.
- **Share target.** The manifest declares a `share_target` (Web Share Target API), so that the installed app is offered in Android's share sheet, and a link shared with it opens in it. Android sends what was shared as `/share?title=…&text=…&url=…`: a `GET`, since a static host serves the page, where a `POST` would need a server or a service worker. The app opens the first link that leads to one of its pages, a Drive link as when pasted (see Deep links) or an address of the app, looking in the shared address, then the text, then the title, where apps put a link with words around it, and dropping the marks that wrap or end a link in a message (`<…>`, `(…)`, a final period or comma). The page it leads to replaces `/share` before the app starts, so that Back and a reload skip the share; a share with no such link leaves `/share`, without what was shared, which says there is nothing to open. What was shared goes to Firebase Hosting in the page's address, as the about page says. Whether the Drive app itself shares a link, rather than a copy of the file, is to be checked on an Android phone. iOS does not support share targets.
- **Keyboard.** Test the keyboard toolbar with Gboard and the Samsung keyboard; `visualViewport` works in Chrome on Android.
- **Browsers.** Test Chrome first; also Samsung Internet if people in the organization use it.

## Interface redesign (milestone 9)

Milestone 9 gives DriveMD the look and the habits of Google's own Workspace apps, Docs and Slides above all, rather than GitHub's: Material Design 3, Google Sans Flex, Material Symbols and Google Drive's neutral greys, with the teal of DriveMD's icon as its one accent. It never uses Google's logos or product icons, nor a name that could pass for a Google product, as the Google Workspace Marketplace branding guidelines require. [`docs/DESIGN.md`](DESIGN.md) holds the visual rules, the tokens and the mockups; this section holds what the interface does. Until each step of the milestone lands, the requirements above describe the app as it is, and each step rewrites the requirements it changes, in its own pull request.

**Three contexts.** The interface follows the screen and the way the tab was opened.

- Phones and wide screens are told apart as the layouts are (see Mobile requirements), wide screens from 768 to 1023 px being tablets. Touch is told by the pointer (`pointer: coarse`), never by the browser's name, and the app added to a home screen by `display-mode: standalone`, where iOS shows no Back button.
- A tab opened from Drive is known only by the `/open?state=…` address that Drive opens, which the app replaces with the note's own before it starts (see Handling the redirect). The app therefore marks the tab then, in `sessionStorage`, which a reload keeps and other tabs do not share; an address of the app typed in the tab ends the mode.

**A tab opened from Drive** holds one note, as a Docs tab holds one document.

- Nothing in it leads elsewhere in the app: no search, breadcrumbs, folder pane, navigation or Back, and DriveMD's mark is not a link. **Move**, whose picker leaves the note open, and **Move to trash** stay; once the note is in the trash, the page says so and offers nothing more. The user returns to Drive in Drive's own tab.
- The note opens in Editing on a wide screen, the source beside the preview, and in reading on a phone, as Docs opens a document on a computer and in its phone app.
- A link to another note opens it in a new tab, in the same mode, as Docs opens links, and a link to a heading of the note scrolls to it. The new tab should not ask the user to sign in again: how the opening tab hands it the token waits for a written security review (see Open questions), and until then the new tab asks for **Continue**.
- Before sign-in, the tab's screen says that Google Drive asked DriveMD to open a note, whose name the app cannot know yet.

**Reading and editing**, in every context:

- On a wide screen, a mode menu, as Docs's, takes the place of **Edit** and **Done**: **Editing** shows the source beside the preview, **Viewing** the note alone. Choosing **Viewing** saves first: nothing is written when nothing changed, and when someone else changed the file, or the save fails, the note stays in Editing with the banner that says why. On a phone, a floating **Edit** button starts editing, and a check at the start of the app bar saves and returns to reading, under the same rules.
- A checkbox ticked while viewing saves at once, as GitHub's task lists do, so that a note being read never holds unsaved changes.
- Saving stays explicit, without autosave. **Save** shows wherever the note can be edited, always in the same place and at the same width: "Saved" when nothing is left to save, "Save" while changes are unsaved, "Saving…" while it writes. While changes are unsaved, the browser tab's title starts with "• ".
- The note's name in the app bar renames the file when clicked, as in Docs, its extension kept out of the field; **Move** is an icon beside it, and **Move to trash** is in a More actions menu. Inside a vault, renaming warns as it does today.
- After a conflict, the choices go by risk: saving the user's version as a copy first, then overwriting Drive's version, then keeping Drive's, which asks again.
- On a wide screen, a note is read on a sheet, as Docs shows a page.

**File navigator:**

- On a wide screen, a navigation drawer, as Google Drive's, lists Home, My Drive, Shortcuts, Shared drives, Shared with me and the vaults beside Home, folders and search; from 768 to 1023 px, a navigation rail does. Their lists are tables: the name, then when and by whom the item was last modified; Recent and search results also give the folder each note sits in, which costs one request per note, filled in as Drive answers. Home then shows the notes with unsaved changes and Recent, the roots and vaults being in the drawer.
- On a phone, Home keeps its four lists; search is a button that opens a full-screen search; a folder shows Back, its name, its breadcrumbs and a floating **New note** button.
- A note opened from the navigator shows its folder's list beside it on a wide screen, in a drawer on a tablet, headed by the folder, which leads back to it, and opens in reading, as today. Breadcrumbs show on folder pages only.
- The account is a round button with its initial, since Google gives DriveMD no photo, which opens a menu: the account's email, **About DriveMD**, so that the offer of the source that the AGPL asks for stays one tap away once signed in, and **Sign out**.

## Risks and gotchas

The biggest risk is damaging files other tools depend on, so the app must never rewrite a file it did not change.

| Risk                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another tool or person edits the file while it is open                                                                 | Store `md5Checksum` and `headRevisionId` on open, reading them before the content so that it is never older than them, and re-read them before saving; if they changed, show the differences and let the user choose (see Save). Do not rely on `version`, which also changes with sharing and metadata                                                                                                                                                                                                                       |
| .md files carry inconsistent MIME types (`text/markdown`, `text/x-markdown`, `text/plain`, `application/octet-stream`) | List a folder's children, then filter by name ending in `.md` or `.markdown` in the app, not by MIME type                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Line endings, encoding or a trailing newline change silently                                                           | Set CodeMirror's `EditorState.lineSeparator` to the file's separator (it joins lines with `\n` by default). Decode with `ignoreBOM: true` to keep a UTF-8 BOM (`TextDecoder` and `Response.text()` drop it otherwise) and with `fatal: true`; open read-only a file that is not valid UTF-8, holds a NUL character (as UTF-16 without a byte order mark does, while passing for UTF-8) or mixes line endings. Compare bytes before writing, and upload with the file's existing `mimeType`                                    |
| Unsaved text is lost when iOS closes the app                                                                           | Keep unsaved text in IndexedDB as the user types; offer to restore it on reopen                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Drive deletes old revisions (after 30 days or 100 versions for non-Google files)                                       | Mark the pre-edit revision as kept forever before the first write of a session (Drive allows 200 such revisions per file)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Access token expires during a long edit                                                                                | Renew inside a user gesture (Save, **Continue**); keep unsaved text; retry once                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| iOS blocks the sign-in popup, or popups fail in Home Screen mode                                                       | Trigger sign-in from a tap; the milestone 1 test passed in Safari and from the Home Screen; a small token backend with redirect sign-in remains the fallback                                                                                                                                                                                                                                                                                                                                                                  |
| Admin API Controls block the app                                                                                       | Ask the admin to mark it Trusted, or turn on trust for internal apps                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rendered Markdown runs injected HTML or scripts                                                                        | Sanitize HTML with `rehype-sanitize` (GitHub schema) and set a strict Content Security Policy that enforces Trusted Types, locked by a test on `firebase.json`: with the full `drive` scope, an XSS exposes the user's whole Drive                                                                                                                                                                                                                                                                                            |
| The access token leaks through injected script or browser storage                                                      | Keep the token only for the tab (memory and `sessionStorage`), send it only in the `Authorization` header, never log it or put it in a URL or an error message, and forget it on sign-out or a 401; strict CSP with Trusted Types                                                                                                                                                                                                                                                                                             |
| Google's sign-in script runs with full page access and cannot be pinned with Subresource Integrity                     | The CSP allows only its exact URL, Trusted Types lets the app load it only through its own policy, and the CSP allows no other Trusted Types policy                                                                                                                                                                                                                                                                                                                                                                           |
| A compromised dependency or workflow abuses the deploy credentials                                                     | Workload Identity Federation instead of a key, accepted only for this repository's CI workflow on `dev` and `main`; the deploy account can only manage Firebase Hosting, but of both sites, so what reaches `dev` is trusted as much as what reaches `main`; the job holding credentials runs no build tooling; actions are pinned by commit and audited by zizmor                                                                                                                                                            |
| A crafted note crashes the renderer or makes the Markdown parser run for seconds                                       | A note nested deeper than the renderer's stack shows as written instead of rendered. Parsing and code highlighting run on the main thread, so a note built to make them slow (about 10 s for 12 KB of Markdown, or 4 s for a 20 KB code block) freezes its tab until they finish or the tab is closed; rendering in a worker the app can stop is the fix if it matters in practice                                                                                                                                            |
| A crafted note makes the app read thousands of links, images or embedded notes from Drive                              | Relative links and images are looked up only as they come near the screen, four at a time, and an image waiting for the screen takes room, so that only those the screen holds come near it together. Images over 10 MB are not read, and their bytes leave the cache 30 s after their note. A note can still make a tab read many images as the user scrolls through it Embedded notes are read as they come near the screen too, four at a time, ten a note at most and three deep, but each may hold up to 1 MB to render. |
| Renaming or moving a file in a vault breaks Obsidian links to it                                                       | Warn before renaming or moving inside a vault; never rewrite other files                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Some files shared by link need a resource key                                                                          | Carry `resourcekey` in links and send `X-Goog-Drive-Resource-Keys`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Large folders                                                                                                          | Paginate with `pageToken`; request only needed `fields`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Build plan for Claude Code

Build in nine milestones, each ending with something that runs; give Claude Code this doc plus one milestone at a time.

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
   - Carried over from milestone 3, and settled: link resolution and search say when Drive answers that its search was incomplete (`incompleteSearch`), rather than calling a link broken; a note's vault cannot be found past a folder out of the user's reach, since Drive names no such folder (see Obsidian vaults).
6. **Routing and links.** `/edit?id=` with resource keys, paste a Drive link, `/open?state=` and `/new?state=` handlers.
   - Done when: each URL opens the right file after sign-in.
   - Carried over from milestone 3, and settled: breadcrumbs rebuilt from parents read each parent without its resource key, which the app does not know. Only some old items shared by link carry one, "a subset of old files" that Google's 2021 security update keyed, so no test item can be made. Google's 2021 notice to developers says that a request for such an item without its key "may result in a 404 Not Found error": the path then ends there, at Shared with me, as at any parent out of reach, which a unit test pins.
7. **Drive integration and Marketplace.** Manual console steps from the Open with section; deploy to `md.corp.edgeweave.tech` once the domain is verified.
   - Done when: right-click > Open with in Drive on the web opens the file in the app.
   - Carried over from milestone 6, and settled: Drive's templates always send `folderResourceKey`, so empty when the folder has none, and `exportIds` beside `ids`, as the app expects; Google shows its account chooser for a token request with `login_hint` and `prompt: select_account`. Drive's **New** does not call the app (see requirement 9).
8. **Mobile polish.** Manifest and icons, 16 px editor font, keyboard toolbar, Android share target, smart punctuation check. Safe areas and the Add to Home Screen hint move to milestone 9, whose layout they need.
   - Done when: tested on a real iPhone (Safari and Home Screen) first, then on an Android phone (Chrome tab and installed app).
   - Carried over from milestone 3, and settled: the move picker opens at the folder the file really sits in, rather than along the path the user took, which may end where a shortcut to the file sits (see requirement 7).
9. **Interface redesign.** The look of Google's Workspace apps and the three contexts of Interface redesign, after `docs/DESIGN.md`, in steps that each land alone, in this order:
   1. Two defects found while reviewing the interface: a broken shortcut's name breaks mid-word on a phone, and the conflict's folded unchanged lines show almost white in the dark theme.
   2. Google Sans Flex and Google Sans Code served by the app, as woff2 subsets, with their license in `LICENSES/`.
   3. The tokens of `src/tokens.css` in place of GitHub's colors, the editor and highlighted code included.
   4. Material Symbols as inline SVG wherever the app shows an icon, and the buttons' emphases.
   5. The file navigator's app bar: the search bar, the account button and its menu, and the full-screen search on a phone.
   6. The navigation drawer and rail, the file tables and their Location column.
   7. The note's app bar: renaming by the name, **Move**, More actions, **Save**'s three states and the tab title's mark.
   8. The mode menu and its saving rules, the checkbox that saves while viewing, and on a phone the floating **Edit** button and the Done check.
   9. The note's sheet and type.
   10. The tab opened from Drive: the marked tab, no way out, Editing on a wide screen, and its sign-in screen.
   11. The conflict's banner and the order of its choices.
   12. The security review of a token handed to a new tab, then links to other notes opening in new tabs from a tab opened from Drive.
   13. Carried over from milestone 8: safe areas, the Add to Home Screen hint, and the keyboard toolbar no longer covering the end of the note.
   - Done when: the app shows each screen of `docs/design/mockups/` on a computer, an iPad and an iPhone, in both themes; a note opened from Drive offers no way into the rest of the app; switching to Viewing saves; and the end-to-end tests and live checks pass.

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
- [x] Which icon does DriveMD get? The Markdown mark, which its author dedicated to the public domain, in white on a teal plate: `public/icon.svg`, also the browser tab's icon. The Home Screen and Android's launcher get the mark on a plate that fills the square, `public/icon-maskable.svg`, since they cut it to their own shape.
- [x] Do the Drive iOS and Android apps show web apps under Open with? No: the iPhone app opens no .md file and lists no web app, as Google's Drive help says of both apps, while Drive in a phone's browser opens DriveMD (see Phone limit).
- [ ] How does a tab that a tab opened from Drive opens get its token, so that the user does not sign in again? The token lives in `sessionStorage`, which a new tab does not share, so a new tab now asks for **Continue**. A written security review of the handoff comes first (milestone 9, step 12).

## Sources

- [Google: configure the OAuth consent screen (Marketplace)](https://developers.google.com/gsuite/marketplace/configure-oauth-consent-screen)
- [Google: OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Google: configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk)
- [Google: configure the Marketplace SDK](https://developers.google.com/workspace/marketplace/enable-configure-sdk), [create a store listing](https://developers.google.com/workspace/marketplace/create-listing) and [publish an app](https://developers.google.com/workspace/marketplace/how-to-publish)
- [Google: install Marketplace apps for your organization](https://knowledge.workspace.google.com/admin/apps/install-marketplace-apps-for-your-organization)
- [Google Search Console: verify your site ownership](https://support.google.com/webmasters/answer/9008080)
- [Google Drive help: use Google Drive apps](https://support.google.com/drive/answer/2500820)
- [Google: access link-shared files using resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys)
- [Google Workspace Updates: Drive file link updates (2021)](https://workspaceupdates.googleblog.com/2021/06/drive-file-link-updates.html), and Google's notice to developers, quoted in [GNOME gvfs#576](https://gitlab.gnome.org/GNOME/gvfs/-/issues/576)
- [Obsidian: Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown)
- [Obsidian: Basic formatting syntax](https://obsidian.md/help/syntax)
- [Obsidian: Callouts](https://obsidian.md/help/callouts)
- [Obsidian: Internal links](https://obsidian.md/help/links)
- [Obsidian: Embed files](https://obsidian.md/help/embeds)
- [Obsidian: Properties](https://obsidian.md/help/properties)
- [Material Design 3](https://m3.material.io)
- [Google Workspace Marketplace branding guidelines](https://developers.google.com/workspace/marketplace/terms/branding)
