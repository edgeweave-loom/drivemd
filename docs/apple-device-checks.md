# Device checks on iPhone and iPad

The end-to-end tests run Playwright's WebKit with an iPhone's and an iPad's screen, and the live checks run the deployed app the same way. Neither has iOS itself: Safari's bars, the on-screen keyboard, the notch and the home bar, the Home Screen app or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the iOS Simulator, and readable by a person with a real device. Run it on staging before a milestone that changes the interface closes, and before a release reaches production.

## Rules for the agent

- **Report, do not fix.** Run the checks and write the report. Do not change the app's code, do not file issues and do not push anything: draft the issues in the report, for the developer to file.
- **Staging only.** Check `https://md-staging.corp.edgeweave.tech`, or the address the developer gives, never production unless asked.
- **The test account only.** The developer signs in. Never type, read or keep a password or a code, and take no screenshot of Google's sign-in pages. The account's email shows in the app, and in the account button's label that `mobile_list_elements_on_screen` returns: write `<test account>` in the report instead, and keep screenshots out of the repository and of any upload, since they show its name.
- **Logs only to explain a failure.** The device's logs (`mobile_get_device_logs`) can hold the account's email and Google's tokens. Collect them only to explain a FAIL, narrowed with `filter` and `limit`, into the output folder. Quote in the report only the lines the verdict needs, with `<test account>` for the email and no token. Screen recordings show the email, as screenshots do.
- **Touch only the check's files.** Create, edit and trash only the `device-check-*` notes below, in the test account's My Drive.
- **One verdict per check:** PASS, FAIL (what was expected, what showed, and the screenshot), or BLOCKED (what the Simulator could not do, and what a real device should check instead). A known limit that the spec describes is a PASS with a note, not a FAIL.
- **Ask the developer** whenever Google asks for credentials, when macOS asks for a permission, and when a check needs something the Simulator lacks. The Simulator has no Bluetooth, so Google's 2-Step Verification cannot use the developer's phone as a security key: they pick another way, such as the prompt on their phone, an authenticator code or a backup code, without copying the code on the Mac (see the clipboard, under [Tools](device-setup-apple.md#tools)).

## Setup

Set up the Mac, the Simulator's devices and the tools as [`device-setup-apple.md`](device-setup-apple.md) says, which also says what to do when a tool or a device fails.

### Output

Write everything to a folder outside the repository, such as `~/drivemd-device-checks/<date>/`: the report, `report.md`, and the screenshots, named `<check>-<device>-<context>-<orientation>-<theme>.png`, such as `C2-iphone-safari-left-light.png`.

### Version

Read the version that staging serves with `curl -s https://md-staging.corp.edgeweave.tech/version.json`, and write it at the top of the report, with the date, Xcode's version (`xcodebuild -version`), the iOS runtime and the devices. The account menu must show the same version (check A2).

### Notes for the checks

Make four made-up notes in the test account's My Drive, from the app on the iPhone, after check A1: on **My Drive**, tap **New note**, name it, then **Edit**, paste the text, and tap **Done**. When they exist from a previous run, paste their text again, so that each run starts from the same notes.

- `device-check-long.md`, enough lines to scroll past two screens:

  ```sh
  { echo "# Long note"; echo; for i in $(seq 1 80); do echo "Line $i of a made-up note, long enough to scroll."; done; } | xcrun simctl pbcopy "DriveMD iPhone"
  ```

- `device-check-tasks.md`:

  ```markdown
  # Tasks

  - [ ] Water the plants
  - [x] Book the train

  See [the other note](device-check-other.md) and [the end](#the-end).

  ## The end

  Nothing else here.
  ```

- `device-check-other.md`:

  ```markdown
  # Other note

  A short made-up note that the tasks link to.
  ```

- `device-check-visual.md`, with something of each kind that Visual hides or draws, and of those it leaves as written:

  ````text
  # Visual check

  Some **bold words**, _an italic phrase_, ~~a struck word~~ and `inline code`, in a paragraph long enough to wrap onto a second line on a phone held upright.

  ## A heading with closing marks ##

  - A bullet
  - [ ] An open task
  - [x] A done task

  1. A numbered item
  2. Another one

  See [the other note](device-check-other.md), [a web page](https://example.com) and a [reference link][ref].

  ```js
  const tea = "green";
  ```

  - - -

  | Tea | Cups | A column wide enough to scroll on a phone |
  | :-- | ---: | ----------------------------------------- |
  | Green \| hot | **2** | Some words to make it wider than the screen |

  > A quote with **bold** words, long enough to wrap onto a second line on a phone held upright.
  > > A nested quote

  Setext heading
  ==============

  [ref]: https://example.com
  ````

## Order

Run the sections in this order, so that each context is set up once:

1. iPhone, Safari: A, B, C, D, G, H, J, K.
2. iPhone, Home Screen app: E, then C and D again in it.
3. iPad, Safari: A, B, C, D, G, K.
4. iPad, Home Screen app: E, then C and D again in it.
5. Both devices, both themes: F.
6. I, only if staging deploys a new version during the run.

Run every check in the light theme unless it says otherwise: E3, section F, H2 and K17 also run the dark one. Once such a check ends, set the device back to light (`xcrun simctl ui <device> appearance light`) before the next one.

## Checks

### A. Sign-in and version

- **A1.** Open staging in Safari and tap **Sign in**; the developer finishes in Google's window. Home shows, signed in.
- **A2.** The account button, round with the account's initial, opens a menu with the email, **About DriveMD**, **Sign out** and the version, which is `version.json`'s.

### B. The Add to Home Screen banner

- **B1.** Before sign-in, Home shows no banner. Once signed in, a banner under the app bar says **Add DriveMD to your Home Screen**, with the share icon, "In Safari, tap Share, then Add to Home Screen, to open DriveMD in a window of its own." and **Got it**.
- **B2.** Open a folder and come back to Home: the banner is still there. Tap **Got it**: it goes, and stays gone after a reload and in a new Safari tab.
- **B3.** iPad only, as information: with **I/O ▸ Input ▸ Send Pointer to Device**, a trackpad's pointer, should show no banner, as a Mac does; the Simulator may still report a touch screen. Record what shows; a real iPad with a trackpad settles it. DeviceHub has no such item: mark B3 BLOCKED there.

### C. Safe areas

On each of these screens: Home, a folder (My Drive), `device-check-tasks.md` read, the same note edited, the account menu, the Move dialog (**Move** beside the note's name, or More actions ▸ **Move** on a phone), and on the iPhone the full-screen search; on the iPad, the navigation rail (upright), the navigation drawer (sideways) and a note's folder drawer (upright).

- **C1. Upright.** No text, icon or control sits under the Dynamic Island, the status bar or the home bar, nor in the screen's rounded corners. The bars' and pages' backgrounds run to the screen's edges, with no band of another color above, below or beside them.
- **C2. Sideways, both ways** (Landscape Left, then Landscape Right, or Rotate Left, then Rotate Right): the same, with content kept clear of the Dynamic Island's side, while the bars' backgrounds still run under it. On the iPhone, the layout stays the phone's.
- **C3. Scrolled.** On the long note and on a folder with more items than the screen holds, scrolled to the end: the last line and the last item come fully above the home bar.
- **C4. iPhone SE** (optional): no empty band where a notch or a home bar would be.

### D. The keyboard toolbar

With the on-screen keyboard (**Simulate Hardware Keyboard** off in DeviceHub, **Connect Hardware Keyboard** off in the Simulator app; see Typing, under [Tools](device-setup-apple.md#tools)). Open `device-check-long.md`, then **Edit** ▸ **Source**, or on the iPad the mode menu ▸ **Source**.

- **D1. Shown.** Tap the first line: the on-screen keyboard comes up, and the toolbar right above it, one row of keys (Undo, Redo, Heading, Bold, List, Checkbox, Link, Indent, Outdent, Find in note), with no empty second row under them. In Safari it sits on the address bar that floats above the keyboard. Swipe the row sideways when its keys do not fit.
- **D2. Typing at the note's end.** Scroll to the end, tap after the last line, then ten times: tap Return and type `x`. Each time, the line being typed shows fully above the toolbar. In Safari, the toolbar may first sit above the keyboard and move down onto it as lines are typed: the spec describes it, and it is a PASS as long as no typed line hides under the toolbar.
- **D3. Deleting at the note's end.** Tap the keyboard's delete key twenty times, once for each `x` and each line break typed in D2: the toolbar stays on the keyboard, never under its rounded top, nor with a gap. This matters most in the Home Screen app. After the twentieth tap, the ten lines are gone and the note shows **Saved**, and in Safari, the tab's title has no "•". **Save** means that a tap took two characters, and the note lost a line break at its end, which does not show (issue #202): record a FAIL with the taps, then tap Return at the note's end, which brings **Saved** back, so that D5 starts from Drive's text.
- **D4. Cursor clearance.** In the middle of the note, tap the last line visible above the toolbar: the note scrolls so that the cursor sits clear of the toolbar.
- **D5. Keys keep the keyboard.** Select a word and tap Bold, then List, Checkbox, Indent and Outdent: after each, the keyboard is still up and the text has its Markdown, then Undo takes back one tap at a time. Find in note takes the app bar's place on the iPhone, or shows under it on the iPad, with its field focused, the keyboard still up and the toolbar out of the way; typing a word counts its matches, Return and ˅ step to the next, which shows clear of the bars, with the keyboard still up; ⋮ opens its menu right under it, and Back or Close gives the text the focus again at that match, clear of the toolbar, which comes back.
- **D6. Hardware keyboard.** Turn the hardware keyboard on and tap the text: no on-screen keyboard shows, and the toolbar sits at the screen's bottom, one row tall; over the home bar, as the spec says. Turn it off again.
- **D7. No zoom.** Focusing the editor, Find in note's field, the search box or the New and Rename names never zooms the page.

Then take back the edits with Undo before leaving the editor, since **Done**, and **Viewing** on the iPad, save first; whatever is saved is replaced when the next run pastes the note's text again.

### E. The Home Screen app

- **E1. Install.** In Safari, on a note's page, tap Share ▸ **Add to Home Screen** (in iOS 27, under Share ▸ **Show more**; on the iPhone, Share is in the page menu, ⋯ in the address bar). The name offered is **DriveMD**, and the icon is DriveMD's mark, not a picture of the page. Add it.
- **E2. Launch.** The icon opens the app in a window of its own, without Safari's bars, on Home rather than the note. If it asks to sign in or to **Continue**, the developer does.
- **E3. Status bar.** The status bar takes the page's background, in the light and the dark theme.
- **E4. No banner.** Home shows no Add to Home Screen banner, even before **Got it** was tapped in Safari.
- Then run sections C and D again in the app.

### F. The mockups

Compare each screen with its mockup in `docs/design/mockups/` (the table in `docs/DESIGN.md` says what each shows), in the light and the dark theme (`xcrun simctl ui <device> appearance dark`). The mockups use made-up notes and a computer's or a phone's size: compare what they show, not the data or the exact size, that is the bars and what they hold, the icons, the buttons and their emphasis, type, spacing and colors. Give each mockup a verdict and list every difference, each marked minor or not.

| Mockups                                                                         | Where to look                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `phone-home`, `phone-folder`, `phone-search`                                    | iPhone upright: Home, My Drive, search                                                                            |
| `dark-phone-reading`, `dark-phone-editing`                                      | iPhone upright, dark: `device-check-tasks.md`, read then edited                                                   |
| `drive-tab-phone-sign-in`, `drive-tab-phone-reading`, `drive-tab-phone-editing` | iPhone, a tab opened from Drive (section G)                                                                       |
| `conflict-phone`, `conflict`                                                    | iPhone upright, then iPad sideways: a conflict (below)                                                            |
| `tablet-folder`, `tablet-note`                                                  | iPad upright: My Drive with the navigation rail, then `device-check-long.md` edited with its folder's drawer open |
| `home`, `folder`, `note`, `search`                                              | iPad sideways: Home, My Drive, `device-check-tasks.md`, search                                                    |
| `drive-tab-sign-in`, `drive-tab-editing`, `drive-tab-viewing`                   | iPad sideways, a tab opened from Drive: before sign-in, in Source with a change, then Viewing                     |

To make a conflict, open `device-check-other.md` in two Safari tabs (the second asks for **Continue**), add a line in the second and save it, then add another in the first and save: a banner says that someone changed the file, over the differences, with its choices. Choose **Keep the Drive version**, and confirm, to leave.

### G. A tab opened from Drive

- **G1. Open.** In Safari, open drive.google.com, where the developer signs in to Drive, find `device-check-tasks.md` and open it with DriveMD (**Open with ▸ DriveMD**). If Drive does not offer it there, build the address Drive would open instead: take the note's ID from the app's `/edit?id=<ID>` address, and open `https://md-staging.corp.edgeweave.tech/open?state=` followed by `{"ids":["<ID>"],"action":"open"}` encoded as a URL component; then say in the report that Drive's own part went unchecked.
- **G2. Before sign-in.** Run it in a Safari that never saw the account: once A1 has signed in, the tab shows **Welcome back** instead, so on the iPhone open the address in a private tab, and close it afterwards. The page says "Google Drive asked DriveMD to open a Markdown file. Sign in with your Google account to see it." with **Sign in**, which opens Google's account chooser.
- **G3. The note alone.** No search, no breadcrumbs, no Back and no folders; DriveMD's mark is no link. On the iPhone the note opens read, and More actions holds **Move**, **Move to trash**, the account's email, **About DriveMD** and **Sign out**. On the iPad sideways it opens in the editor, in the mode chosen last: Visual on one sheet at first, or Source beside the preview.
- **G4. A link opens a new tab.** Tap "the other note": it opens in a new Safari tab, in the same mode (G3 holds there too), without asking to sign in or to **Continue**. Close that tab and do it twice more, since a race used to drop the mode now and then.
- **G5. A heading link** ("the end") scrolls to its heading, in the same tab.
- **G6. Reload** keeps the mode.
- **G7. Leaving.** Type staging's address in the tab's address bar: Home shows, with its search and navigation, so the mode has ended.

### H. Home and themes

- **H1. Recent.** Home's Recent lists at most 10 notes, then **Show all**. Show all lists the rest; open a note, come back with Back: Recent is folded again. With fewer than 11 notes opened in the test account, open more of the `device-check-*` notes or mark the check BLOCKED.
- **H2. Dark theme.** With the device in dark appearance, the app is dark on both devices, the editor and the differences included, and it follows a switch back to light without a reload.

### I. A new version (only if staging deploys during the run)

- **I1.** Leave the Home Screen app in the background while staging deploys (`version.json` changes), then bring it back: a banner says **A new version of DriveMD is ready**, with **Reload** and **Later**, and the account menu offers **Reload to update**. Reload shows the new version in the account menu.
- **I2.** With unsaved changes in a note, neither the banner nor the menu item shows until the note is saved.

### J. Typed text, as information

- **J1.** In the editor, tap on the on-screen keyboard: `"quoted" -- it's` and a new line starting with `next`. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, and no capital on `next`.
- **J2.** Type a word, then two spaces with quick taps on the space bar. iOS turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.

### K. Visual, Source and Viewing (v2, stage 1)

On `device-check-visual.md`, which **Edit** opens in Visual, the editor's default mode, on a device that never chose another. The spec's v2 section says what Visual hides and draws. Stage 1 is done once typing, selecting and deleting across formatted text work on a real iPhone: the report says which of these checks a real iPhone must repeat, K4 to K10, K14 and K19 at least, since the Simulator's text input is not the device's.

- **K1. Modes.** On the iPhone, **Edit** shows **Visual**, **Source** and **Preview** over the note, Visual chosen, the three within the screen's width upright and sideways. Source shows the Markdown in light styling, Preview the rendered note, and Visual the editor again. On the iPad sideways, the mode menu offers **Visual**, **Source** and **Viewing**, each with its line ("Edit the note as it reads", "Edit the Markdown beside its preview", "Save, then read the note"): Visual shows the note on one sheet, Source the Markdown beside the preview, and Viewing the note alone.
- **K2. Remembered.** On the iPhone, pick Source, tap the check, reload, and tap **Edit**: the editor opens in Source. Pick Visual before going on.
- **K3. Reading.** In Visual, the keyboard down and no line tapped: no `#`, `**`, `_`, `~~`, backtick, or inline link's `[` or `](…)` shows; the bullet shows as •, the tasks as boxes, the done one ticked, the links as their text in the accent, the `- - -` line as a thin rule across the line, and the table as Preview shows it, "Cups" aligned right, "Green | hot" in one cell and the 2 in bold; the quote shows without its `>`, a bar on its left, both its lines, and two bars beside "A nested quote"; a finger sliding on the table along it scrolls the table, not the page. The numbered list, the code block's fences, the reference link, the setext heading's underline and the line that defines `[ref]` show as written. Take a screenshot beside one of Preview.
- **K4. A tap shows a line's Markdown.** Tap inside "bold words": the keyboard comes up with the toolbar, the paragraph shows its symbols, dimmed, and no other line does; the cursor sits in the word tapped, or the report says where it landed. Tap the heading with closing marks: it shows `## … ##`, and the paragraph hides its symbols again. Tap the rule: it shows `- - -`, the cursor on that line, at the line's height. Tap "2" in the table: it shows as written, the cursor after the `**2**`, its row where the finger was, unless the page was at its top. A line wraps anew as its symbols show or hide, which moves the lines below it, but the heading stays under the finger that tapped it, the cursor where the finger is, unless the page was scrolled to its top: the report says how far it moved. No line but the one tapped shows or hides a symbol.
- **K5. Typing.** After "upright.", at the paragraph's end, type ` and **more**`, then tap another line: the paragraph shows "and more" with "more" in bold, without its `**`.
- **K6. Moving the cursor.** Touch and hold the space bar, then slide, to move the cursor up into the heading and down into the list: each line shows its Markdown as the cursor enters it, and the cursor follows the finger without jumping back or skipping a line.
- **K7. Selecting** (BLOCKED where the Simulator cannot select; see Typing, under [Tools](device-setup-apple.md#tools)). Double-tap "italic", then drag the selection's end handle down to the bullet: every line the selection touches shows its Markdown, the handles stay on the text as lines change, and the menu's **Copy** copies the Markdown, symbols included (paste it in Find in note's field to read it, then close Find in note).
- **K8. Deleting across formatted text.** Select from the middle of "bold words" to the middle of "struck", or in the Simulator any selection across formatted text it can make, and tap the keyboard's delete key: the paragraph loses what was selected, its symbols with it, and nothing else, as Source then shows. **Undo** in the toolbar brings the text back whole.
- **K9. Task boxes.** The keyboard down, tap the box of "An open task": it ticks, the keyboard stays down, and the line keeps its box. Then tap "Some" to bring the keyboard up, and tap the box of "A done task": it unticks, the keyboard stays up, and the cursor stays in the paragraph. **Undo** takes back the last tick alone, then the first. Playwright's WebKit cannot check this one: iOS may move the cursor, or bring the keyboard up, on a tap inside the text.
- **K10. Links.** Tap **Save** first, so that nothing asks to leave: it takes the focus from the text, and the toolbar goes with it. Tap "the other note": the cursor lands in it, the line shows `[the other note](device-check-other.md)`, and the toolbar shows **Open link** (`open_in_new`) in Link's place. Tap it: the other note opens. Come back, tap **Edit**, tap "a web page", then **Open link**: it opens in a new Safari tab. Tap a word outside the links: the key is **Link** again. In Source, the same.
- **K11. Long press.** Touch and hold "a web page": iOS shows its loupe or selects a word, as in any text, and no link opens. Once the finger lifts, the word stays selected, or the cursor where the loupe left it. Do it right after **Edit**, then with the keyboard up, then once Safari's ✓ has closed the keyboard, with the line in the screen's middle: the keyboard comes back up, and the text should move only as far as iOS takes the cursor above the keyboard, not clear of the toolbar too, until the finger lifts. A real iPhone must repeat this one.
- **K12. Typed text.** J1 and J2 on the paragraph, in Visual: the same as in Source.
- **K13. Dictation** (BLOCKED where the Simulator cannot dictate). On the paragraph, dictate "green tea and cups": the words land at the cursor, once, and the line's symbols stay as they were. When the words differ from those spoken, dictate them again into Find in note's field, a plain field on the same page: if they differ there too, the recognition is at fault, not the editor, and the report says so.
- **K14. Japanese and Chinese input.** Add the Japanese (Romaji) and the Chinese (Simplified, Pinyin) keyboards in Settings ▸ General ▸ Keyboard ▸ Keyboards. Inside "bold words", type `ocha` with the Japanese keyboard and pick お茶, then `cha` with Pinyin and pick 茶: the marked text shows while composing, the candidate replaces it once, nothing is doubled or lost, and the line's symbols stay shown meanwhile. Tap another line: the new words show inside the bold text, without its `**`.
- **K15. Find in note.** From the toolbar, find "word": the matches show in Visual, the bar sits in the app bar's place on the iPhone and over the sheet's top on the iPad, and stepping to a match scrolls to it, clear of the keyboard. While its field has the focus, every line keeps its symbols hidden, as the spec says.
- **K16. Saved as typed.** After K5 to K15, tap the check (iPhone) or pick Viewing (iPad): the note saves, and Source shows the edits only, with no symbol lost or added elsewhere, and the code block, the numbered list and the reference link as written.
- **K17. Dark theme.** K3's screen and a tapped line in the dark appearance: the boxes, the bullets, the links and the dimmed symbols stay legible.
- **K18. iPad, hardware keyboard.** With Simulate Hardware Keyboard on, the arrow keys move through the note: from the line above the heading, the down arrow takes the cursor into the heading, which then shows its `## `, at its start or in its text, never between two of its `#`. Shift and the arrows select across formatted lines, which show their Markdown. Turn it off again.
- **K19. Quotes.** Tap the end of "A nested quote": the line shows `> > ` after its two bars, at the line's height, and the quote's first line shows no `>`. Tap Return and type `milk`: the new line starts with `> > `, and "A nested quote" hides its marks. Select from "bold" to "nested" and tap delete: the quote loses what was selected and nothing else, the `>` of its first line where it was, as Source then shows; **Undo** brings the text back whole. Touch and hold the space bar, then slide the cursor through the quote's lines: each shows its `>` as the cursor enters it, and the cursor never lands between a `>` and the space after it. A real iPhone must repeat this one.

## Report

`report.md` holds, in this order:

1. The run: date, staging's version, Xcode, the iOS runtime, the devices, and what could not be set up.
2. A table of every check, by device and context: the check, its verdict, and the screenshots.
3. For each FAIL: the steps, what was expected, what showed, and the screenshots; for each BLOCKED, why, and what a real device should check.
4. The checks a real iPhone or iPad must repeat, and why: section K's, K4 to K10, K14 and K19 at least, and any other whose result rests on the Simulator's text input.
5. The mockups: a verdict for each, and its differences.
6. Draft issues for the FAILs, one per defect, each with a title in the repository's style (a sentence saying what the app should do), the steps and the device, and no screenshot that shows the account's email.
