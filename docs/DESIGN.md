# DriveMD design

DriveMD looks and behaves like Google's own Workspace apps, such as Docs or Slides, rather than like GitHub: [Material Design 3](https://m3.material.io), [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex) and [Material Symbols](https://fonts.google.com/icons). Its own color is the teal of its icon, as Docs has its blue and Sheets its green, on Google Drive's near-neutral greys. It never uses Google's logos or product icons, nor a name that could pass for a Google product, as the [Google Workspace Marketplace branding guidelines](https://developers.google.com/workspace/marketplace/terms/branding) require; it names Drive only to say what it works with.

This file is the reference for milestone 9 of the spec's build plan, which brings the app to it. The spec says what the app does; this file says how it looks. The tokens are in [`src/tokens.css`](../src/tokens.css), which the app imports, and the mockups, drawn on made-up data, in [`design/mockups/`](design/mockups/):

| Mockups                                                                                                                                                                                                                            | What they show                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`drive-tab-editing`](design/mockups/drive-tab-editing.png), [`drive-tab-viewing`](design/mockups/drive-tab-viewing.png), [`drive-tab-sign-in`](design/mockups/drive-tab-sign-in.png)                                              | A note opened from Drive on a computer: editing with unsaved changes, viewing just after the switch saved it (mode menu open), and the screen before sign-in |
| [`drive-tab-phone-reading`](design/mockups/drive-tab-phone-reading.png), [`drive-tab-phone-editing`](design/mockups/drive-tab-phone-editing.png), [`drive-tab-phone-sign-in`](design/mockups/drive-tab-phone-sign-in.png)          | The same on a phone                                                                                                                                          |
| [`dark-editing`](design/mockups/dark-editing.png), [`dark-viewing`](design/mockups/dark-viewing.png), [`dark-phone-reading`](design/mockups/dark-phone-reading.png), [`dark-phone-editing`](design/mockups/dark-phone-editing.png) | The dark theme                                                                                                                                               |
| [`conflict`](design/mockups/conflict.png), [`conflict-phone`](design/mockups/conflict-phone.png)                                                                                                                                   | Someone changed the note in Drive since it was opened                                                                                                        |
| [`home`](design/mockups/home.png), [`folder`](design/mockups/folder.png), [`note`](design/mockups/note.png), [`search`](design/mockups/search.png)                                                                                 | The file navigator on a computer, and a note opened from its folder                                                                                          |
| [`phone-home`](design/mockups/phone-home.png), [`phone-folder`](design/mockups/phone-folder.png), [`phone-search`](design/mockups/phone-search.png)                                                                                | The file navigator on a phone                                                                                                                                |
| [`tablet-folder`](design/mockups/tablet-folder.png), [`tablet-note`](design/mockups/tablet-note.png)                                                                                                                               | A tablet held upright: the navigation rail, and a note being edited with its folder's drawer open                                                            |

## Content

- The interface is in English, in sentence case everywhere: buttons, headings, menu items and badges ("Move to trash", "Shared with me", "Read only").
- Drive's things keep Drive's words: My Drive, Shared drives, Shared with me, Shortcuts, trash, shortcut, folder. A Markdown file is a note in running text, and keeps its file name, extension included, in lists.
- The user is "you". Buttons are verbs ("Save", "Move", "Save mine as a copy"); a status is a past participle ("Saved", "Moved to trash").
- Messages say what happened and what to do, without apology: "This file is in the trash. Restore it from Google Drive to open it."
- No emoji, no exclamation marks, no title case.

## Three contexts

| Context           | When                                                                       | What it shows                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phone             | Narrower than 768 px, or a touch screen less than 500 px tall              | One column: a compact app bar (56 px), lists with a line under each name, reading first with a floating Edit button, Source and Preview in turn while editing, and the keyboard toolbar above the keyboard                           |
| Wide              | 768 px and wider                                                           | An app bar (64 px); the navigation drawer beside Home, folders and search, whose contents sit on a panel as a file table; a folder pane beside a note; Editing (source beside preview) or Viewing (the note on a sheet), from a menu |
| Tablet            | 768 to 1023 px, within Wide                                                | The navigation rail in place of the drawer, and the folder pane in a drawer that opens over the note                                                                                                                                 |
| Opened from Drive | A tab that Drive's **Open with** opened, on any screen, until it is closed | One note and nothing else: no search, breadcrumbs, navigation, folder pane or Back, and the mark is not a link                                                                                                                       |

Touch and mouse are told apart by the pointer (`pointer: coarse`), never by the browser's name, and the app added to a phone's home screen by `display-mode: standalone`, where iOS shows no Back button of its own.

## Color

The tokens are Material Design 3's color roles. Each has a light and a dark value, and the app follows the system's theme, with no switch of its own.

- Surfaces are near-neutral greys with a hint of blue, as in Google Drive; teal is for accents only. On a wide screen the app's background is `app-background`, and notes, editors and panels sit on `sheet`, white in light, a step lighter than the background in dark, so that a sheet reads as raised in both. A phone runs on `surface`.
- Text is `on-surface`, and secondary text (dates, the account, placeholders, inactive icons) `on-surface-variant`: both hold 7:1 or more on every surface, in both themes.
- `primary` is for the one filled action of a view, links, the focus ring and the current item's text; tonal actions are `secondary-container` with `on-secondary-container`.
- `attention-container` is for a notice that needs a decision (a conflict, unsaved changes to restore), `error-container` for a failure, and `error` only for actions that lose data. Material 3 has no warning role: the amber attention colors are harmonized toward the teal.
- What a version adds is underlined on `diff-added`, what it removes struck through on `diff-removed`: never told by color alone.
- `brand-mark` is the icon's own teal, kept for the icon's plate. No text or control takes it.
- Highlighted code takes the same roles, with no hue of its own: keywords and types `primary`, strings, numbers and literals `tertiary`, attributes, properties and variables `secondary`, comments `on-surface-variant` in italic, and names of functions, classes and sections the text's color at 600. Each holds 5:1 or more on a code block, `surface-container-high`, in both themes.

## Type

Everything is set in Google Sans Flex (`--font-sans`), and code in [Google Sans Code](https://github.com/googlefonts/googlesans-code) (`--font-mono`), both under the SIL Open Font License, with the system's fonts as fallback.

| Style           | Size and line, px | Weight | Use                                                                                    |
| --------------- | ----------------- | ------ | -------------------------------------------------------------------------------------- |
| headline-medium | 28 / 36           | 400    | The sign-in screen's heading                                                           |
| headline-small  | 24 / 32           | 400    | A page's heading: Home, a root, a folder, search results                               |
| title-large     | 22 / 28           | 400    | The note's name in the app bar (18 / 24 on a phone), dialog titles                     |
| title-medium    | 16 / 24           | 500    | Banner titles                                                                          |
| title-small     | 14 / 20           | 500    | Section labels on Home (Recent, Vaults, Browse), the navigation drawer's Vaults label  |
| body-large      | 16 / 24           | 400    | List rows on a phone, the search bar                                                   |
| body-medium     | 14 / 20           | 400    | File tables, banner and dialog text, metadata                                          |
| body-small      | 12 / 16           | 400    | The last-modified line under the note's name                                           |
| label-large     | 14 / 20           | 500    | Buttons, menu items, the navigation drawer                                             |
| label-medium    | 12 / 16           | 500    | Badges, the navigation rail's labels                                                   |
| note-h1         | 32 / 40           | 500    | A note's `#` heading (28 / 36 on a phone)                                              |
| note-h2         | 24 / 32           | 500    | `##` (22 / 30 on a phone)                                                              |
| note-h3         | 20 / 28           | 500    | `###`; smaller headings take note-body at 500                                          |
| note-body       | 16 / 26           | 400    | A note's paragraphs, lists and tables, at most 72 characters wide                      |
| note-code       | 14 / 22           | 400    | Code in the rendered note, in Google Sans Code                                         |
| editor          | 16 / 26           | 400    | The Markdown source, code in Google Sans Code: never smaller, or Safari zooms on focus |

A note's headings carry no rule under them, as in Docs. Its tables read as file tables do, a rule in `outline-variant` under each row and none between the columns, their head at body-medium 500 in `on-surface-variant`; a task's box, 18 px, takes `primary`; a thematic break is a 1 px `outline-variant` rule; inline code takes `--radius-xs`.

## Space, shape and depth

- Everything sits on a 4 px grid, `--space-1` (4 px) to `--space-7` (48 px). Page gutters are 16 px on a phone and 24 px wider.
- Controls are pills (`--radius-full`); text fields and code blocks take `--radius-sm` (8 px), banners, sheets' top corners and the note's editor `--radius-md` (12 px), panels `--radius-lg` (16 px), dialogs and the search bar `--radius-xl` (28 px).
- On a wide screen, a note shows as Docs shows a page: a sheet 816 px wide, 64 px of padding above and 72 px at the sides, `--elevation-1`, down to the window's bottom. While editing, the source and the preview are two sheets side by side, sharing the width, 32 px of padding at their sides (24 px on a tablet), each headed by its label-large name in `on-surface-variant` with its icon, `code` Markdown and `visibility` Preview. The source has no frame of its own: its lines run from edge to edge of the sheet, or of a phone's screen, their text as far in as the text beside it, and the cursor's line shows on `surface-container-low` while it has the focus, as in Docs, marked at its start by a 2 px `primary` rule, rather than a ring. What heads the note, its banners and badges, lines up with the sheet, or spans both while editing.
- Only what floats is lifted: `--elevation-1` for a sheet, a hovered filled button and a focused search bar, `--elevation-2` for menus and the app bar once the page scrolls under it, `--elevation-3` for dialogs, the snackbar and the floating buttons. Everything else is flat, set apart by its surface rather than by borders.

## States and focus

- Hover lays the content's color over a control at 8%, focus and press at 10%.
- The focus ring is a solid 2 px `primary` outline, 2 px outside the control: at least 5:1 on every surface in light, 7:1 in dark.
- A disabled control is `on-surface` at 38% on 12%, and only for an action that will come back. Save's "Saved" is a status, not a disabled control: it stays legible.
- Motion uses Material's standard easing, `cubic-bezier(0.2, 0, 0, 1)`, over 150 to 300 ms, and drops to nothing when the system asks for reduced motion.

## Touch

- Every control is at least 48 px (`--touch-target`) on a touch screen; a button can stay 40 px tall (`--control-height`) with an invisible margin. The keyboard toolbar's keys are 44 px.
- Nothing works on hover alone.
- Bars at the screen's edges add `env(safe-area-inset-*)` to their padding: the app bar under the iPhone's status bar, the floating buttons, the snackbar and the keyboard toolbar above the home bar.

## Icons

Material Symbols Outlined, at weight 400, grade 0 and optical size 24, filled only for the current item; 18 px inside a button. The app inlines them as SVG, as the keyboard toolbar already does, under the Apache License in [`LICENSES/`](../LICENSES/).

| Icon                                      | Means                                               |
| ----------------------------------------- | --------------------------------------------------- |
| `home`, `cloud`, `shortcut`               | Home, My Drive (never Drive's logo), Shortcuts      |
| `folder_shared`, `group`, `book`          | Shared drives, Shared with me, an Obsidian vault    |
| `folder`, `folder_open`, `description`    | A folder, the folder of the note shown, a note      |
| `link_off`                                | A broken shortcut                                   |
| `edit`, `visibility`, `code`              | Editing, Viewing (and Preview), the Markdown source |
| `cloud_done`, `check`                     | Saved; Done on a phone                              |
| `drive_file_move`, `delete`, `more_vert`  | Move, Move to trash, More actions                   |
| `search`, `close`, `arrow_back`, `add`    | Search, clear or close, Back, New note              |
| `sync_problem`                            | Someone changed the note in Drive                   |
| `undo`, `redo`, `title`, `format_bold`, … | The keyboard toolbar's keys, as the spec lists them |

The DriveMD mark, `public/icon.svg`, shows at 40 px in the app bar (32 px on a phone) and is never recolored or redrawn.

## Components

Measurements are in CSS pixels; colors are tokens.

- **App bar.** 64 px, or 56 px on a phone, on `app-background` (wide) or `surface` (phone). In the file navigator: the mark and "DriveMD", leading Home, lined up with the navigation drawer; the search bar; the account. On a note: the mark, the note's name with its Move button and the last-modified line under it, then the mode menu, Save, More actions (Move to trash) and the account. On a phone: Back or Done, the note's name, Save and More actions, or, on Home, the mark, "DriveMD", Search and the account.
- **Account.** A 32 px round button with the account's initial on `primary-container`, since Google gives DriveMD no photo, which opens a menu: the email address, About DriveMD and Sign out.
- **Buttons.** Pills 40 px tall, 24 px of side padding (16 px before an icon), label-large. Filled (`primary`) for the one main action; tonal (`secondary-container`) for frequent ones, such as New note and the mode menu; outlined (`outline` border) for the safe way out of a choice; text for the least weight; danger (`error`) only to confirm a loss. Icon buttons are 40 px circles, their name in `aria-label` and a tooltip.
- **Save.** Always in the same place while the note can be edited, at least 112 px wide so that nothing beside it moves: "Saved" with `cloud_done` in `on-surface-variant`, without a container; "Save", filled; "Saving…", tonal with a spinner. Saved and Saving… are `aria-disabled`, not `disabled`, so that the button stays reachable and announces its state. While changes are unsaved, the browser tab's title starts with "• ".
- **Note's name.** It reads as text and renames the file when clicked: an `outline-variant` outline on hover, the focus ring while typing, Enter or leaving the field to rename, Escape to cancel. The extension stays outside the field in `on-surface-variant`.
- **Mode menu.** A tonal button naming the current mode (`edit` Editing, `visibility` Viewing) and a menu of the two, each with a line that says what it does: "Edit the Markdown beside its preview", "Save, then read the note". The current mode is `secondary-container`, announced as a checked radio item. Wide screens only.
- **Floating Edit button.** On a phone, while reading a note that can be edited: 56 px, `--radius-lg`, `primary-container`, at the bottom right, 16 px from the edges plus the home bar's inset. The folder's New note button takes the same shape, with its label.
- **Source and Preview.** While editing on a phone: a segmented button, 40 px, outlined, the chosen half `secondary-container` with a check.
- **Navigation drawer.** 256 px on `app-background`: Home, My Drive, Shortcuts, Shared drives, Shared with me, then a Vaults label and one item per vault; items are 40 px pills, the current one `secondary-container` with a filled icon. **Navigation rail**, between 768 and 1023 px: 80 px wide, 56 × 32 px pill indicators over 12 px labels, the vaults behind one Vaults item, which opens a menu of them beside it.
- **Panel.** Beside the drawer or the rail: a `sheet` with 16 px top corners, 24 px of padding, holding the page's heading, breadcrumbs on a folder, and its list.
- **File table.** On a wide screen, a folder's, Recent's and the search's items as table rows, 48 px tall, each one link with an `outline-variant` rule under it: Name (icon, name, badges), then Modified ("Sep 1, 2026, by Ada Lovelace"); Recent and search add Location, the item's folder, filled in as Drive answers. Folders come first in a folder, as today; Recent and search keep their order by date.
- **List row.** On a phone: 56 px, or 72 px with the line under the name (where it sits and when it changed, or why a shortcut is broken), an icon, the name wrapping anywhere rather than overflowing, a chevron for what opens a list. The folder pane beside a note uses dense rows, 40 px (48 px on touch), the open note `secondary-container`.
- **Breadcrumbs.** On folder pages only: `on-surface-variant` steps with a pill hover, the current one `on-surface` at 500 and not a link, `chevron_right` between them.
- **Search.** On a wide screen, a 48 px pill on `surface-container-high`, at most 720 px wide, `sheet` with `--elevation-1` while focused. On a phone, an icon that opens a full-screen search on `surface-container-high`, with Back and Clear.
- **Badge.** 20 px, `--radius-xs`, label-medium: neutral (outline) for what an item is (Shortcut), `secondary-container` for where it belongs (Vault), `attention-container` for what the user cannot do (Read only).
- **Banner.** Under the app bar, `--radius-md`, 16 px of padding: an icon, a title-medium title, one or two sentences, and its actions. `attention-container` for a decision, `error-container` for a failure. The conflict's actions go by risk: Save mine as a copy (filled), Overwrite with mine (outlined), Keep the Drive version (danger text, which asks again).
- **Differences.** Google Sans Code at 14 / 22 on `sheet`, lines padded 12 px; unchanged runs folded into a `surface-container` line ("14 unchanged lines").
- **Snackbar.** `inverse-surface`, `--radius-xs`, `--elevation-3`, at the bottom left (bottom on a phone): one past-tense sentence ("Saved to Google Drive") and at most one action in `inverse-primary`, gone after 4 seconds, 10 with an action.
- **Dialog.** `surface-container-high`, `--radius-xl`, `--elevation-3`, over a `scrim` at 32%: the question as its title, one or two sentences of consequence, then Cancel and the action named by its verb, a loss in danger.
- **Keyboard toolbar.** `surface-container`, 48 px, 44 px keys that scroll sideways, as the spec describes it.

## In the app

- The tokens are `src/tokens.css`, which `src/index.css` imports, and the editor's theme takes the same ones through CodeMirror's constructed style sheets. Obsidian's callouts and highlights keep Obsidian's own colors, as the spec says.
- The security policy loads nothing from other sites: the fonts ship with the app as woff2 subsets, with their license in `LICENSES/`, and icons are inline SVG rather than an icon font, which would also show its ligature words while it loads.
- No inline `style` attribute: the policy blocks them.
