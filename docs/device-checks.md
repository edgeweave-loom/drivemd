# Device checks on iPhone, iPad and Android

The end-to-end tests run Playwright's WebKit with an iPhone's and an iPad's screen, and Chromium with a phone's, and the live checks run the deployed app the same way. Neither has iOS or Android itself: the browser's bars, the on-screen keyboard, the notch or the camera's cutout, the home bar or the gesture bar, the Home Screen app or the installed one, Android's Back and share sheet, or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the iOS Simulator or the Android Emulator, and readable by a person with a real device. Run it on staging, on both platforms, before a milestone that changes the interface closes, and before a release reaches production.

## At a glance

- **Who.** Claude Code on a Mac, with the developer at hand to sign in to Google, and to the Play Store on Android, and to grant macOS's permissions; or a person with a real device, who follows Order and Checks and skips the setup.
- **How to start.** Set up the Mac as [`device-setup-apple.md`](device-setup-apple.md) or [`device-setup-android.md`](device-setup-android.md) says, open Claude Code in the repository, accept the `mobile` MCP server it offers, and ask it to run the checks of `docs/device-checks.md` on staging, on iOS or on Android.
- **How to read it.** Each check holds on both platforms, with Chrome for Safari, the Android phone for the iPhone, the tablet for the iPad, the installed app for the Home Screen app and the emulator for the Simulator. **Android:** says what differs there, and a check marked (iOS) or (Android) runs on that platform alone.
- **What comes out.** A report with a verdict for every check, its screenshots and draft issues, in a folder outside the repository (see Output and Report).

| Section | What it checks                             | iOS                                  | Android                                                                              |
| ------- | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------ |
| A       | Sign-in and the version shown              | iPhone and iPad, Safari              | Phone and tablet, Chrome; phone, Samsung Internet                                    |
| B       | The Add to Home Screen banner              | iPhone and iPad, Safari              | Phone, Chrome: no banner                                                             |
| C       | Safe areas                                 | Every context                        | Every context but Samsung Internet                                                   |
| D       | The keyboard toolbar                       | Every context                        | Every context                                                                        |
| E       | The Home Screen app, or the installed app  | iPhone and iPad                      | Phone and tablet                                                                     |
| F       | The screens against `docs/design/mockups/` | Both devices, both themes            | Both devices, both themes                                                            |
| G       | A tab opened from Drive                    | iPhone and iPad, Safari              | Phone and tablet, Chrome                                                             |
| H       | Home's Recent and the dark theme           | iPhone, Safari; H2 on both devices   | Phone, Chrome; H2 on both devices                                                    |
| I       | The offer of a new version                 | Only if staging deploys during a run | Only if staging deploys during a run                                                 |
| J       | Typed text that the keyboard would rewrite | iPhone, Safari                       | Phone, Chrome                                                                        |
| K       | Visual, Source and Viewing                 | iPhone and iPad, Safari              | Phone and tablet, Chrome; K3, K5, K9 and K10 in the phone's app and Samsung Internet |
| L       | The share target                           |                                      | Phone, installed app                                                                 |
| M       | Android's Back                             |                                      | Phone: Chrome, the installed app and Samsung Internet                                |

## Rules for the agent

- **Report, do not fix.** Run the checks and write the report. Do not change the app's code, do not file issues and do not push anything: draft the issues in the report, for the developer to file.
- **Staging only.** Check `https://md-staging.corp.edgeweave.tech`, or the address the developer gives, never production unless asked.
- **The test account only.** The developer signs in. Never type, read or keep a password or a code, and take no screenshot of Google's sign-in pages. The account's email shows in the app, and in the account button's label that `mobile_list_elements_on_screen` returns: write `<test account>` in the report instead, and keep screenshots out of the repository and of any upload, since they show its name.
- **Logs only to explain a failure.** The device's logs (`mobile_get_device_logs`) can hold the account's email and Google's tokens. Collect them only to explain a FAIL, narrowed with `filter` and `limit`, into the output folder. Quote in the report only the lines the verdict needs, with `<test account>` for the email and no token. Screen recordings show the email, as screenshots do.
- **Touch only the check's files.** Create, edit and trash only the `device-check-*` notes below, in the test account's My Drive.
- **One verdict per check:** PASS, FAIL (what was expected, what showed, and the screenshot), or BLOCKED (what the Simulator could not do, and what a real device should check instead). A known limit that the spec describes is a PASS with a note, not a FAIL.
- **Ask the developer** whenever Google asks for credentials, when macOS asks for a permission, and when a check needs something the Simulator lacks. The Simulator has no Bluetooth, so Google's 2-Step Verification cannot use the developer's phone as a security key: they pick another way, such as the prompt on their phone, an authenticator code or a backup code, without copying the code on the Mac (see the clipboard, under [Tools](device-setup-apple.md#tools)).

### On Android

The rules above hold, with Chrome for Safari and the emulator for the Simulator, and these on top:

- **Accounts on the device.** Add no Google account to Android (Settings ▸ Passwords & accounts) or to Chrome yourself. The installed app needs the Play Store (E1), whose sign-in adds the test account to Android: the developer signs in there, as in the app. Nothing else needs an account on the device, but the Drive app of L4, if the developer chooses to install it.
- **The developer runs DevTools.** When a value from the page is needed, ask the developer to open `chrome://inspect#devices` in Chrome on the Mac, inspect the emulator's tab or the installed app, and run what you give them. Do not connect to Chrome's debugging port yourself (`adb forward … chrome_devtools_remote`): it reaches the page's tokens.
- **Logs.** `mobile_get_device_logs` reads logcat, which holds the account's email and Google's tokens as iOS's log does: the same rule applies.

## Setup

Set up the Mac, the devices and the tools as [`device-setup-apple.md`](device-setup-apple.md) says for iOS, or [`device-setup-android.md`](device-setup-android.md) for Android; each also says what to do when a tool, a device or the emulator fails.

### Output

Write everything to a folder outside the repository, such as `~/drivemd-device-checks/<date>/`: the report, `report.md`, and the screenshots, named `<check>-<device>-<context>-<orientation>-<theme>.png`, such as `C2-iphone-safari-left-light.png`.

**Android:** a folder of its own, such as `~/drivemd-device-checks/<date>-android/`, with `phone` and `tablet` for the device and `chrome`, `app` or `samsung` for the context: `C2-phone-chrome-left-light.png`.

### Version

Read the version that staging serves with `curl -s https://md-staging.corp.edgeweave.tech/version.json`, and write it at the top of the report, with the date, Xcode's version (`xcodebuild -version`), the iOS runtime and the devices. The account menu must show the same version (check A2).

**Android:** with the date, the emulator's version, the API level and the devices, and the versions of Chrome and Gboard (`adb -s <serial> shell dumpsys package com.android.chrome | grep versionName`, and `com.google.android.inputmethod.latin`). An image's Chrome can be months old, and nothing updates it without the Play Store: say so in the report when it is older than Chrome's stable release.

### Notes for the checks

Make five made-up notes in the test account's My Drive, from the app on the iPhone, after check A1: on **My Drive**, tap **New note**, name it, then **Edit**, paste the text, and tap **Done**. When they exist from a previous run, paste their text again, so that each run starts from the same notes.

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

  > A quote holding a table
  > > | Milk | Sugar |
  > > | --- | ---: |
  >> | Oat | 1 |

  Setext heading
  ==============

  [ref]: https://example.com
  ````

- `device-check-callouts.md`, in a vault: a folder `device-check-vault` in My Drive holding an empty `.obsidian` folder, which the developer makes once on drive.google.com, since the app makes no folder. Make the note in the vault's folder, as the others:

  ```markdown
  # Callouts

  > [!faq]- Why keep notes in Markdown, with a title long enough to wrap on a phone?
  > Because any editor reads them.

  > [!tldr]
  > Short notes.

  > [!note] Plan
  >
  > > [!warning] Dates
  > > Friday.
  ```

**Android:** the same five notes, made from the app on the phone after check A1. For the long note, run its command without `| xcrun simctl pbcopy …`, and give its output to `mobile_clipboard`.

## Order

### iOS

Run the sections in this order, so that each context is set up once:

1. iPhone, Safari: A, B, C, D, G, H1, J, K.
2. iPhone, Home Screen app: E, then C and D again in it.
3. iPad, Safari: A, B, C, D, G, K.
4. iPad, Home Screen app: E, then C and D again in it.
5. Both devices, both themes: F and H2.
6. I, only if staging deploys a new version during the run.

Run every check in the light theme unless it says otherwise: E3, section F, H2, K17 and K27 also run the dark one. Once such a check ends, set the device back to light (`xcrun simctl ui <device> appearance light`) before the next one.

### Android

1. Phone, Chrome: A, B, C, D, G, H1, J, K, M.
2. Phone, installed app: E, then C, D and M again in it, with K3, K5, K9 and K10, and L.
3. Tablet, Chrome: A, C, D, G, K.
4. Tablet, installed app: E, then C and D again in it.
5. Phone, Samsung Internet, installed from the Play Store, which the developer signed in to for E1: A, D and M, with K3, K5, K9 and K10.
6. Both devices, both themes: F and H2.
7. I, only if staging deploys a new version during the run.

On each device, D6 comes first, in Chrome, before Gboard's full keyboard has ever come up (see Typing, under [Tools](device-setup-android.md#tools)): on the phone, before C6, whose D1 to D3 bring the full keyboard up. The first time the editor opens on a device, check K1's default, **Edit** opening Visual, before section D picks Source, which the device then remembers. Run every check in the light theme, unless it says otherwise: E3, section F, H2 and K17 also run the dark one, after which the device goes back to light (`adb -s <serial> shell cmd uimode night no`).

## Checks

Each check holds on both platforms, with the substitutions of At a glance; **Android:** says what differs there, and a check marked (iOS) or (Android) runs on that platform alone.

### A. Sign-in and version

- **A1.** Open staging in Safari and tap **Sign in**; the developer finishes in Google's window. Home shows, signed in.
- **A2.** The account button, round with the account's initial, opens a menu with the email, **About DriveMD**, **Sign out** and the version, which is `version.json`'s.

**Android:** Google's sign-in opens in a Chrome window of its own, or in a tab, over the app; once done, it comes back to the app's tab.

### B. The Add to Home Screen banner

- **B1.** Before sign-in, Home shows no banner. Once signed in, a banner under the app bar says **Add DriveMD to your Home Screen**, with the share icon, "In Safari, tap Share, then Add to Home Screen, to open DriveMD in a window of its own." and **Got it**.
  - **Android:** Home shows no **Add DriveMD to your Home Screen** banner, before sign-in nor after: the banner is for iOS. Record, as information, whether Chrome offers its own install prompt or an install icon in its address bar.
- **B2** (iOS). Open a folder and come back to Home: the banner is still there. Tap **Got it**: it goes, and stays gone after a reload and in a new Safari tab.
- **B3** (iOS). iPad only, as information: with **I/O ▸ Input ▸ Send Pointer to Device**, a trackpad's pointer, should show no banner, as a Mac does; the Simulator may still report a touch screen. Record what shows; a real iPad with a trackpad settles it. DeviceHub has no such item: mark B3 BLOCKED there.

### C. Safe areas

On each of these screens: Home, a folder (My Drive), `device-check-tasks.md` read, the same note edited, the account menu, the Move dialog (**Move** beside the note's name, or More actions ▸ **Move** on a phone), and on the iPhone the full-screen search; on the iPad, the navigation rail (upright), the navigation drawer (sideways) and a note's folder drawer (upright).

**Android:** the same screens, with the phone for the iPhone and the tablet for the iPad.

- **C1. Upright.** No text, icon or control sits under the Dynamic Island, the status bar or the home bar, nor in the screen's rounded corners. The bars' and pages' backgrounds run to the screen's edges, with no band of another color above, below or beside them.
  - **Android:** No text, icon or control sits under the status bar, the camera's cutout or the gesture bar, nor in the screen's rounded corners. The bars' and pages' backgrounds run to the screen's edges, or to Chrome's own bars, with no band of another color.
- **C2. Sideways, both ways** (Landscape Left, then Landscape Right, or Rotate Left, then Rotate Right): the same, with content kept clear of the Dynamic Island's side, while the bars' backgrounds still run under it. On the iPhone, the layout stays the phone's.
  - **Android:** `user_rotation` 1, then 3 on the phone; 0, then 2 on the tablet: the same, with content kept clear of the cutout's side, while the bars' backgrounds still run under it. On the phone, the layout stays the phone's.
- **C3. Scrolled.** On the long note and on a folder with more items than the screen holds, scrolled to the end: the last line and the last item come fully above the home bar.
  - **Android:** the last line and the last item come fully above the gesture bar.
- **C4. iPhone SE** (iOS, optional): no empty band where a notch or a home bar would be.
- **C5. Three buttons** (Android). With the navigation's three buttons instead of the gesture bar, C1 and C3 again: nothing sits under the buttons' bar, and no empty band shows where the gesture bar was. On the tablet, the three buttons come in Android's taskbar, apps first. Switch back to gestures.
- **C6. Address bar at the bottom** (Android, phone, Chrome): with Chrome's address bar at the screen's bottom (Chrome ▸ Settings ▸ Address bar), C1 and C3 again, and D1 to D3 in section D, after D6 (see Order). Put it back at the top.

### D. The keyboard toolbar

With the on-screen keyboard (**Simulate Hardware Keyboard** off in DeviceHub, **Connect Hardware Keyboard** off in the Simulator app; see Typing, under [Tools](device-setup-apple.md#tools)). Open `device-check-long.md`, then **Edit** ▸ **Source**, or on the iPad the mode menu ▸ **Source**.

**Android:** with Gboard's full keyboard, but for D6. Open `device-check-long.md`, then **Edit** ▸ **Source**, or on the tablet the mode menu ▸ **Source**.

- **D1. Shown.** Tap the first line: the on-screen keyboard comes up, and the toolbar right above it, one row of keys (Undo, Redo, Heading, Bold, Italic, List, Checkbox, Link, Indent, Outdent, Find in note), with no empty second row under them. In Safari it sits on the address bar that floats above the keyboard. When its keys do not fit, the last one in view is cut in the middle of its icon, under a shade; swipe the row sideways: a shade shows at its left too, and the right one goes at the row's end.
  - **Android:** the toolbar sits right on Gboard, which has no address bar floating above it: no gap, no overlap with Gboard's own row of suggestions.
- **D2. Typing at the note's end.** Scroll to the end, tap after the last line, then ten times: tap Return and type `x`. Each time, the line being typed shows fully above the toolbar. In Safari, the toolbar may first sit above the keyboard and move down onto it as lines are typed: the spec describes it, and it is a PASS as long as no typed line hides under the toolbar.
  - **Android:** run it twice: with Gboard up before the tap at the note's end, then with Gboard down (Back) before it, so that the tap brings Gboard up.
- **D3. Deleting at the note's end.** Tap the keyboard's delete key twenty times, once for each `x` and each line break typed in D2: the toolbar stays on the keyboard, never under its rounded top, nor with a gap. This matters most in the Home Screen app. After the twentieth tap, the ten lines are gone and the note shows **Saved**, and in Safari, the tab's title has no "•". **Save** means that a tap took two characters, and the note lost a line break at its end, which does not show (issue #202): record a FAIL with the taps, then tap Return at the note's end, which brings **Saved** back, so that D5 starts from Drive's text.
  - **Android:** delete with Gboard's delete key. Whatever Save shows, record it; issue #202 was seen on iOS alone.
- **D4. Cursor clearance.** In the middle of the note, tap the last line visible above the toolbar: the note scrolls so that the cursor sits clear of the toolbar.
- **D5. Keys keep the keyboard.** Select a word and tap Bold, then List, Checkbox, Indent and Outdent: after each, the keyboard is still up and the text has its Markdown, then Undo takes back one tap at a time. Find in note takes the app bar's place on the iPhone, or shows under it on the iPad, with its field focused, the keyboard still up and the toolbar out of the way; typing a word counts its matches, Return and ˅ step to the next, which shows clear of the bars, with the keyboard still up; ⋮ opens its menu right under it, and Back or Close gives the text the focus again at that match, clear of the toolbar, which comes back.
  - **Android:** select the word with a long press, which the emulator does.
- **D6. Hardware keyboard.** Turn the hardware keyboard on and tap the text: no on-screen keyboard shows, and the toolbar sits at the screen's bottom, one row tall; over the home bar, as the spec says. Turn it off again.
  - **Android:** first, before Gboard's full keyboard has come up on the device: tap the text. Only Gboard's floating ≡ shows, and the toolbar sits at the screen's bottom, over the gesture bar, one row tall. Then Alt+K brings up the full keyboard for the rest. Wherever the full keyboard has come up before, it is BLOCKED, and in the installed app too: once the Play Store has installed it, Gboard restarts and brings its full keyboard up at each tap in a field, in Chrome as in the app, a letter typed folding it to the ≡ only until the next tap (Gboard 18.0.3, seen on a wiped emulator on 2026-10-25, [#289](https://github.com/edgeweave-loom/drivemd/issues/289)). It takes a real phone with a hardware keyboard.
- **D7. No zoom.** Focusing the editor, Find in note's field, the search box or the New and Rename names never zooms the page.
- **D8. Back hides the keyboard** (Android). With the keyboard up, press Back once: the keyboard goes, the note stays, and the toolbar moves to the screen's bottom, over the gesture bar, or in Samsung Internet onto its bottom bar, as the spec says. Tap the text: the keyboard and the toolbar come back together.
- **D9. Samsung keyboard** (Android). BLOCKED: the emulator has no Samsung keyboard, which comes only on Samsung's phones.

Then take back the edits with Undo, and on Android pick Visual again, before leaving the editor, since **Done**, and **Viewing** on the iPad, save first; whatever is saved is replaced when the next run pastes the note's text again.

### E. The Home Screen app, or the installed app

- **E1. Install.** In Safari, on a note's page, tap Share ▸ **Add to Home Screen** (in iOS 27, under Share ▸ **Show more**; on the iPhone, Share is in the page menu, ⋯ in the address bar). The name offered is **DriveMD**, and the icon is DriveMD's mark, not a picture of the page. Add it.
  - **Android:** in Chrome, on a note's page, tap ⋮ ▸ **Add to home screen** ▸ **Install** (or **Install app**). The dialog offers the name **DriveMD** and DriveMD's mark, not a picture of the page. Chrome makes the app through the Play Store: while the Play Store has no account, Chrome makes a shortcut instead, with Chrome's badge on the icon. Then ask the developer to sign in to the Play Store, which adds the test account to Android; remove the shortcut and install again. Once installed, the launcher shows the mark cut to its own shape, a circle on a Pixel, with the whole mark inside. If the developer chooses not to sign in, record it, run E with the shortcut, and mark L BLOCKED.
- **E2. Launch.** The icon opens the app in a window of its own, without Safari's bars, on Home rather than the note. If it asks to sign in or to **Continue**, the developer does.
  - **Android:** without Chrome's bars. The launch screen before the page is light, the manifest's background, with the mark. Each launch may ask **Continue** (see Continue, under [Tools](device-setup-android.md#tools)). When the launcher has moved the icon, launch the app with `adb -s <serial> shell monkey -p <package> -c android.intent.category.LAUNCHER 1`, its package from `adb -s <serial> shell pm list packages | grep webapk`.
- **E3. Status bar.** The status bar takes the page's background, in the light and the dark theme.
  - **Android:** the status bar and the gesture bar's band take the page's background, in the light and the dark theme. On the tablet, Chrome paints both bands itself, as the spec's Home Screen app requirement says: record their colors, and the same in C and D8 in the installed app, as Chrome's rather than failures.
- **E4. No banner.** Home shows no Add to Home Screen banner, even before **Got it** was tapped in Safari.
  - **Android:** Home shows no Add to Home Screen banner.
- **E5. Its own app** (Android). Overview lists DriveMD as an app of its own, with its name and its mark, apart from Chrome; Settings ▸ Apps lists it too.
- Then run sections C and D again in the app, and on the Android phone M, K3, K5, K9 and K10.

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

**Android:** for the conflict, open `device-check-other.md` in two Chrome tabs. `drive-tab-sign-in` and `drive-tab-phone-sign-in` show before sign-in, in a tab that Drive opened with an account: type `/open?state=` in a Chrome tab's address bar, followed by the URL-encoded `{"ids":["<id>"],"action":"open","userId":"<digits>"}`, with a test note's ID and made-up digits, and the tab signs in afresh, with the account the device remembers left alone. An address that an intent or a link opens goes to the installed app instead, even with its links turned off.

### G. A tab opened from Drive

**Android:** in Chrome. Drive in Chrome on a phone may offer its app first: tap to stay in the browser.

- **G1. Open.** In Safari, open drive.google.com, where the developer signs in to Drive, find `device-check-tasks.md` and open it with DriveMD (**Open with ▸ DriveMD**). If Drive does not offer it there, build the address Drive would open instead: take the note's ID from the app's `/edit?id=<ID>` address, and open `https://md-staging.corp.edgeweave.tech/open?state=` followed by `{"ids":["<ID>"],"action":"open"}` encoded as a URL component; then say in the report that Drive's own part went unchecked.
  - **Android:** Drive's mobile site has no **Open with**: switch Chrome to ⋮ ▸ **Desktop site**, where a long press on the file offers it. Drive's **Open with ▸ DriveMD** opens production, the only DriveMD that Drive knows: close that tab untouched, and open the address that G1 builds when Drive does not offer DriveMD, on staging.
- **G2. Before sign-in.** Run it in a Safari that never saw the account: once A1 has signed in, the tab shows **Welcome back** instead, so on the iPhone open the address in a private tab, and close it afterwards. The page says "Google Drive asked DriveMD to open a Markdown file. Sign in with your Google account to see it." with **Sign in**, which opens Google's account chooser.
  - **Android:** run it in an Incognito tab, from ⋮ ▸ **New Incognito tab**; on the tablet, Ctrl+Shift+N opens a second window instead, side by side, which ⋮ ▸ **Manage windows** closes. Chrome keeps Incognito out of screenshots: read the page from its elements.
- **G3. The note alone.** No search, no breadcrumbs, no Back and no folders; DriveMD's mark is no link. On the iPhone the note opens read, and More actions holds **Move**, **Move to trash**, the account's email, **About DriveMD** and **Sign out**. On the iPad sideways it opens in the editor, in the mode chosen last: Visual on one sheet at first, or Source beside the preview.
- **G4. A link opens a new tab.** Tap "the other note": it opens in a new Safari tab, in the same mode (G3 holds there too), without asking to sign in or to **Continue**. Close that tab and do it twice more, since a race used to drop the mode now and then.
  - **Android:** the new tab is one of Chrome's, with the app installed from E1: not the installed app, which would ask **Continue** (see Handing the token to a new tab in the spec). Check first that Android lets the app take staging's links, or the note stays in Chrome whatever the app does: `adb -s <serial> shell pm get-app-links <package>` must say `verified` for staging's domain. After a boot it said `1024`, a failed check, until `adb -s <serial> shell pm verify-app-links --re-verify <package>` (seen on 2026-10-24).
- **G5. A heading link** ("the end") scrolls to its heading, in the same tab.
- **G6. Reload** keeps the mode.
- **G7. Leaving.** Type staging's address in the tab's address bar: Home shows, with its search and navigation, so the mode has ended.

### H. Home and themes

- **H1. Recent.** Home's Recent lists at most 10 notes, then **Show all**. Show all lists the rest; open a note, come back with Back: Recent is folded again. With fewer than 11 notes opened in the test account, open more of the `device-check-*` notes or mark the check BLOCKED.
- **H2. Dark theme.** With the device in dark appearance, the app is dark on both devices, the editor and the differences included, and it follows a switch back to light without a reload.
  - **Android:** the dark appearance is `adb -s <serial> shell cmd uimode night yes`.

### I. A new version (only if staging deploys during the run)

- **I1.** Leave the Home Screen app in the background while staging deploys (`version.json` changes), then bring it back: a banner says **A new version of DriveMD is ready**, with **Reload** and **Later**, and the account menu offers **Reload to update**. Reload shows the new version in the account menu.
- **I2.** With unsaved changes in a note, neither the banner nor the menu item shows until the note is saved.

**Android:** the installed app goes to the background with Home.

### J. Typed text, as information

- **J1.** In the editor, tap on the on-screen keyboard: `"quoted" -- it's` and a new line starting with `next`. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, and no capital on `next`.
  - **Android:** on Gboard's keys. After the apostrophe, Gboard goes back to its letters by itself. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, no corrected word, and no capital on `next`.
- **J2.** Type a word, then two spaces with quick taps on the space bar. iOS turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.
  - **Android:** Gboard turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.

### K. Visual, Source and Viewing (v2)

On `device-check-visual.md`, which **Edit** opens in Visual, the editor's default mode, on a device that never chose another. The spec's v2 section says what Visual hides and draws. Stage 1 is done once typing, selecting and deleting across formatted text work on a real iPhone: the report says which of these checks a real iPhone must repeat, K4 to K10, K14, K19, K20, K25 and K26 at least, since the Simulator's text input is not the device's.

**Android:** typing on Gboard's keys. Gboard sends what it types through composition: it holds the word being typed as marked text, which it may rewrite as it goes, where iOS does that only for Japanese or Chinese. Visual changes a line's text as the cursor enters it, so these checks watch for letters or symbols lost, doubled or moved. The emulator runs Gboard itself, so it stands for a phone here, as it did for milestone 8: the report says which checks a real phone must repeat, if any, and why.

- **K1. Modes.** On the iPhone, **Edit** shows **Visual**, **Source** and **Preview** over the note, Visual chosen, the three within the screen's width upright and sideways. Source shows the Markdown in light styling, Preview the rendered note, and Visual the editor again. On the iPad sideways, the mode menu offers **Visual**, **Source** and **Viewing**, each with its line ("Edit the note as it reads", "Edit the Markdown beside its preview", "Save, then read the note"): Visual shows the note on one sheet, Source the Markdown beside the preview, and Viewing the note alone.
  - **Android:** section D picks Source, which the device remembers: the default, **Edit** opening Visual, is checked before D (see Order). On the tablet, the mode menu offers **Visual**, **Source** and **Viewing** upright and sideways.
- **K2. Remembered.** On the iPhone, pick Source, tap the check, reload, and tap **Edit**: the editor opens in Source. Pick Visual before going on.
- **K3. Reading.** In Visual, the keyboard down and no line tapped: no `#`, `**`, `_`, `~~`, backtick, or inline link's `[` or `](…)` shows; the bullet shows as •, the tasks as boxes, the done one ticked, the links as their text in the accent, the `- - -` line as a thin rule across the line, and the table as Preview shows it, "Cups" aligned right, "Green | hot" in one cell and the 2 in bold; the quote shows without its `>`, a bar on its left, both its lines, and two bars beside "A nested quote"; a finger sliding on the table along it scrolls the table, not the page. The numbered list, the code block's fences, the reference link, the setext heading's underline and the line that defines `[ref]` show as written. Take a screenshot beside one of Preview.
- **K4. A tap shows a line's Markdown.** Tap inside "bold words": the keyboard comes up with the toolbar, the paragraph shows its symbols, dimmed, and no other line does; the cursor sits in the word tapped, or the report says where it landed. Tap the heading with closing marks: it shows `## … ##`, and the paragraph hides its symbols again. Tap the rule: it shows `- - -`, the cursor on that line, at the line's height. Tap "2" in the table: that cell alone shows `**2**`, the cursor after it, on the cursor's line's color over a `primary` rule, the table drawn around it and where it was. A line wraps anew as its symbols show or hide, which moves the lines below it, but the heading stays under the finger that tapped it, the cursor where the finger is, unless the page was scrolled to its top: the report says how far it moved. No line but the one tapped shows or hides a symbol.
  - **Android:** tap inside "bold words", record whether Gboard underlines a word, then type `tea` on Gboard's keys: the letters land at the cursor, once each and in order, and the line's `**` stay where they were.
- **K5. Typing.** After "upright.", at the paragraph's end, type ` and **more**`, then tap another line: the paragraph shows "and more" with "more" in bold, without its `**`.
- **K6. Moving the cursor.** Touch and hold the space bar, then slide, to move the cursor up into the heading and down into the list: each line shows its Markdown as the cursor enters it, and the cursor follows the finger without jumping back or skipping a line.
  - **Android:** move the cursor with the handle that Chrome shows under it after a tap, and by sliding on Gboard's space bar, BLOCKED if the emulator's swipe cannot slide there.
- **K7. Selecting** (BLOCKED where the Simulator cannot select; see Typing, under [Tools](device-setup-apple.md#tools)). Double-tap "italic", then drag the selection's end handle down to the bullet: every line the selection touches shows its Markdown, the handles stay on the text as lines change, and the menu's **Copy** copies the Markdown, symbols included (paste it in Find in note's field to read it, then close Find in note).
  - **Android:** a long press on "italic" selects it, with Chrome's handles and menu.
- **K8. Deleting across formatted text.** Select from the middle of "bold words" to the middle of "struck", or in the Simulator any selection across formatted text it can make, and tap the keyboard's delete key: the paragraph loses what was selected, its symbols with it, and nothing else, as Source then shows. **Undo** in the toolbar brings the text back whole.
  - **Android:** with Gboard's delete key.
- **K9. Task boxes.** The keyboard down, tap the box of "An open task": it ticks, the keyboard stays down, and the line keeps its box. Then tap "Some" to bring the keyboard up, and tap the box of "A done task": it unticks, the keyboard stays up, and the cursor stays in the paragraph. **Undo** takes back the last tick alone, then the first. Playwright's WebKit cannot check this one: iOS may move the cursor, or bring the keyboard up, on a tap inside the text.
  - **Android:** "the keyboard down" means the editor without the focus: pick Preview, then Visual (phone), or Viewing, then Visual (tablet), before tapping the box. With Gboard hidden by Back, the editor keeps the focus, which K24 checks.
- **K10. Links.** Tap **Save** first, so that nothing asks to leave: it takes the focus from the text, and the toolbar goes with it. Tap "the other note": the cursor lands in it, the line shows `[the other note](device-check-other.md)`, and the toolbar shows **Open link** (`open_in_new`) in Link's place. Tap it: the other note opens. Come back, tap **Edit**, tap "a web page", then **Open link**: it opens in a new Safari tab. Tap a word outside the links: the key is **Link** again. In Source, the same.
  - **Android:** in the installed app, the other note opens in the app; record where the web page opens, over the app (a Custom Tab) or in Chrome.
- **K11. Long press.** Touch and hold "a web page": iOS shows its loupe or selects a word, as in any text, and no link opens. Once the finger lifts, the word stays selected, or the cursor where the loupe left it. Do it right after **Edit**, then with the keyboard up, then once Safari's ✓ has closed the keyboard, with the line in the screen's middle: the keyboard comes back up, and the text should move only as far as iOS takes the cursor above the keyboard, not clear of the toolbar too, until the finger lifts. A real iPhone must repeat this one.
  - **Android:** a long press on "a web page" selects a word, and Chrome's menu for links (**Open in new tab**, …) does not show.
- **K12. Typed text.** J1 and J2 on the paragraph, in Visual: the same as in Source.
  - **Android:** with J1's and J2's Android variants.
- **K13. Dictation** (BLOCKED where the Simulator cannot dictate). On the paragraph, dictate "green tea and cups": the words land at the cursor, once, and the line's symbols stay as they were. When the words differ from those spoken, dictate them again into Find in note's field, a plain field on the same page: if they differ there too, the recognition is at fault, not the editor, and the report says so.
  - **Android:** with Gboard's microphone: BLOCKED unless the developer turns on the emulator's ⋯ ▸ Microphone ▸ **Virtual microphone uses host audio input** and speaks.
- **K14. Japanese and Chinese input.** Add the Japanese (Romaji) and the Chinese (Simplified, Pinyin) keyboards in Settings ▸ General ▸ Keyboard ▸ Keyboards. Inside "bold words", type `ocha` with the Japanese keyboard and pick お茶, then `cha` with Pinyin and pick 茶: the marked text shows while composing, the candidate replaces it once, nothing is doubled or lost, and the line's symbols stay shown meanwhile. Tap another line: the new words show inside the bold text, without its `**`.
  - **Android:** with Gboard's Japanese keyboard, in its QWERTY layout, and its Chinese (Pinyin) one, added from Gboard's settings ▸ Languages. Gboard's Pinyin keeps the typed letters in its own bar by default (**Inline composing** off), so the page shows no marked text for it: check that the candidate lands once.
- **K15. Find in note.** From the toolbar, find "word": the matches show in Visual, the bar sits in the app bar's place on the iPhone and over the sheet's top on the iPad, and stepping to a match scrolls to it, clear of the keyboard. While its field has the focus, every line keeps its symbols hidden, as the spec says.
- **K16. Saved as typed.** After K5 to K15, tap the check (iPhone) or pick Viewing (iPad): the note saves, and Source shows the edits only, with no symbol lost or added elsewhere, and the code block, the numbered list and the reference link as written.
- **K17. Dark theme.** K3's screen and a tapped line in the dark appearance: the boxes, the bullets, the links and the dimmed symbols stay legible.
- **K18. iPad, hardware keyboard.** With Simulate Hardware Keyboard on, the arrow keys move through the note: from the line above the heading, the down arrow takes the cursor into the heading, which then shows its `## `, at its start or in its text, never between two of its `#`. Shift and the arrows select across formatted lines, which show their Markdown. Turn it off again.
  - **Android:** with arrow keys sent through `adb`: `adb -s <serial> shell input keyevent KEYCODE_DPAD_DOWN`, and `input keycombination KEYCODE_SHIFT_LEFT KEYCODE_DPAD_DOWN` to select.
- **K19. Quotes.** Tap the end of "A nested quote": the line shows `> > ` after its two bars, at the line's height, and the quote's first line shows no `>`. Tap Return and type `milk`: the new line starts with `> > `, and "A nested quote" hides its marks. Select from "bold" to "nested" and tap delete: the quote loses what was selected and nothing else, the `>` of its first line where it was, as Source then shows; **Undo** brings the text back whole. Touch and hold the space bar, then slide the cursor through the quote's lines: each shows its `>` as the cursor enters it, and the cursor never lands between a `>` and the space after it. A real iPhone must repeat this one.
- **K20. Table cells.** Tap "2" in the table, as in K4, and type `0`: only that cell changes, and the keyboard toolbar shows the table's keys, without **Heading**, **List**, **Checkbox**, **Indent** or **Outdent**. Tap **Undo**: the cell shows `**2**` again. Type ` | 3`: the cell shows `**2** \| 3`, and the table keeps its rows and columns. Tap the keyboard's delete key until the cell is empty, then type `4`. Tap "Green | hot": that cell shows `Green \| hot`, and the other one `4`, drawn. Tap a line outside the table: the table is drawn again, and Source shows the table's second row as `| Green \| hot | 4 | Some words to make it wider than the screen |`, with nothing else changed. Tap `4`, then the keyboard's Return: a row comes under the table's last, the cursor in its **Cups** cell and the keyboard staying up; type `5<br>6` and tap a line outside the table: the cell shows 5 above 6, and Source shows `|  | 5<br>6 |  |` under the row that ends `wider than the screen |`, and no other line changed. On the iPad with a hardware keyboard: Tab and Return move to the next cell and to the one below, Tab in the last cell adds a row, and Shift+Return writes `<br>` in the cell, a line break once the cell is left; the arrows move from cell to cell, Left and Right once the cursor is at the text's edge, and out of the table at its edges, to the line before or after it; from the blank line above the table, the right arrow edits **Tea**, and from the blank line under it, the left arrow edits the last cell; Escape shows the table as written. Then tap **Undo** until **Save** reads **Saved**. A real iPhone must repeat this one.
  - **Android:** Gboard's Return as the iPhone's. On the tablet, the hardware keyboard's keys sent through `adb`: `adb -s <serial> shell input keyevent KEYCODE_TAB`, and `KEYCODE_ENTER`, `KEYCODE_ESCAPE` and `KEYCODE_DPAD_UP`, `_DOWN`, `_LEFT` or `_RIGHT` in its place, and `input keycombination KEYCODE_SHIFT_LEFT KEYCODE_ENTER` for Shift+Return.
- **K21. Gboard's suggestions** (Android). If Gboard shows suggestions over its keys while typing in the paragraph, pick one: it replaces the word being typed, once, and nothing around it. The editor turns spellcheck off, so Gboard may show none: record which.
- **K22. Return and delete** (Android). At the end of "An open task", tap Gboard's Return: a new line starts with `- [ ] `, as Return does in Source. Tap delete until the cursor is back after "An open task": the markup goes as it does in Source, and the note is as before. Then hold delete over a few words of the paragraph: the letters go one at a time, none twice, and the `**` go only once the cursor reaches them.
- **K23. A tick while composing** (Android). Type `gre` in the paragraph, without a space, then tap the open task's box: it ticks, and `gre` stays, once. Type `en`: the word reads `green`. Tap the box again, so that K24 finds it open.
- **K24. Back** (Android). With Gboard up and the cursor in the paragraph, press Back: Gboard goes, and the editor keeps the focus, as D8 says; record whether the paragraph keeps its symbols shown. Tap the open task's box: it ticks, and Gboard stays down.
- **K25. Table rows and columns.** Tap "Tea" in the table: the keyboard toolbar shows **Undo** and **Redo**, then the table's keys in groups between rules: **Add row below** and **Delete row**, **Add column to the right** and **Delete column**, then **Align left**, **Align center** and **Align right**, with **Delete row** off and **Align left** highlighted; **Table options** (⋮) sits at the row's right end, after a rule, and the last key in view before it is cut in the middle of its icon, under a shade; the two delete keys show a cross where the add keys show a plus. Tap **Align center**: "Tea" moves to the middle of its column, above "Green | hot", and **Align center** is highlighted; tap **Undo**: "Tea" moves back, and **Align left** is highlighted again; tap **Redo**, then **Undo**: "Tea" centers, then moves back. Scroll the toolbar to its end: **Table options** stays where it is. Tap it: a menu shows right above the key, its right edge 8 px in from the screen's, under the app bar and within the screen, with **Insert line break**, then **Add row above**, **Move row up**, **Move row down**, **Add column to the left**, **Move column left** and **Move column right**, with **Add row above**, **Move row up**, **Move row down** and **Move column left** off; tap the note's heading to close it. Tap "2" in the table, then **Add column to the right**: an empty column comes after **Cups**, the cursor in its cell on the row of "2", the keyboard staying up; type `3`. Tap **Align center**: **Align center** is highlighted, `3` staying put, alone in its column, which is no wider. Tap **Table options**, then **Move column left**: the new column comes before **Cups**, the cursor still in `3`. Tap **Table options**, then **Insert line break**: the cell shows `3<br>`, the cursor after it, the keyboard staying up; tap **Undo**: the cell shows `3`; tap **Redo**, then type `4`. Tap **Add row below**, then **Delete row**: a row comes under the table's last and goes again, the keyboard staying up. Tap a line outside the table: the new column shows 3 above 4, and Source shows the table as `| Tea |  | Cups | A column wide enough to scroll on a phone |`, `| :-- | :-: | ---: | ----------------------------------------- |` and `| Green \| hot | 3<br>4 | **2** | Some words to make it wider than the screen |`, with no other line changed. Touch and hold "Tea": iOS shows its loupe or selects a word, and no table menu shows. Then tap **Undo** until **Save** reads **Saved**. Hold the iPhone sideways, tap "Tea", then **Table options**: the menu shows above the key and under the app bar, scrolling if it is taller than the room between them. A real iPhone must repeat this one.
  - **Android:** Gboard staying up as the iPhone's keyboard does. A long press on "Tea" selects a word or shows Chrome's own menu, never the table's menu: Chrome asks for the context menu with a long press.
- **K26. A table in a quote.** The keyboard down, the table under "A quote holding a table" shows as Preview shows it, "Sugar" aligned right, no `>` showing, two bars on its left running on from the line above it, its text starting where that line's does, as quiet. A finger sliding along the table scrolls it, if wider than the screen, its cells passing under neither bar. Tap "Oat": that cell alone shows its text, the cursor after it, the table drawn around it and no `>` showing, and the keyboard toolbar shows the table's keys. Type ` milk`, then tap the keyboard's Return: a row comes under the table's last, the cursor in its **Milk** cell, the keyboard staying up; type `Soy`. Tap **Table options**, then **Move row up**: "Soy" comes above "Oat milk", the cursor still in it. Tap a line outside the table: Source shows `> A quote holding a table`, `> > | Milk | Sugar |`, `> > | --- | ---: |`, `>> | Soy |  |` and `>> | Oat milk | 1 |`, each line's `>` as written, with no other line changed. Then tap **Undo** until **Save** reads **Saved**. A real iPhone must repeat this one.
  - **Android:** Gboard's Return as the iPhone's.
- **K27. Callouts.** Open `device-check-callouts.md`, which **Edit** opens in Visual. The keyboard down, each callout shows as Preview shows it, the first one folded: a box in its type's color, orange then teal, with its edge on the left, no `>` or `[!…]` showing, its title after its type's icon in the box's color, the long one wrapping beside its icon, and the second titled "Tldr"; the first one's chevron, at its title's right end, points right. Tap the chevron: the callout opens, its chevron turning down, without the keyboard coming up. Tap "any editor": the line shows `> ` before its text, in the box, at the line's height, and the title's line still shows its icon. Tap the long title: its line shows `> [!faq]- ` before it, quieter, the title still in orange and the icon gone. Change `faq` to `tip`: the box turns teal once the cursor leaves the line. Tap the end of "Short notes." and the keyboard's Return, and type `milk`: the new line starts with `> `, in the box. Select from "editor" to "Short" and tap delete: the callouts lose what was selected and nothing else, as Source then shows; **Undo** brings it back. Tap the chevron again: the callout folds. The third callout shows an orange box in its blue one, one level in. Tap "Friday.": its line shows `> > ` before it, inside the orange box, at the line's height. Tap past the title's end: the cursor goes to the title's end, and the callout stays folded. Then tap **Undo** until **Save** reads **Saved**, and the check: no save is asked for. Run it in light and dark. A real iPhone must repeat this one.
  - **Android:** Gboard's Return as the iPhone's.

**Android:** then tap Undo until Save reads **Saved**, so that K21 to K24, which come after K16's save, leave no unsaved changes for the next context.

### L. The share target (Android, installed app, phone)

Take `device-check-tasks.md`'s ID from the app's `/edit?id=<ID>` address, as `ID=<ID>` in the Mac's shell.

- **L1. From Chrome.** In a Chrome tab on that note's page, tap ⋮ ▸ **Share**: the share sheet offers DriveMD, with its mark. Pick it: the note opens in the installed app.
- **L2. A Drive link with words around it.** Share a text holding a Drive link: `adb -s <serial> shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'See <https://drive.google.com/file/d/$ID/view>, it is there.'"`, and pick DriveMD in what Android offers. The note opens; Back leaves for the launcher rather than to `/share`, and a reload keeps the note.
- **L3. No link.** Share a text without a link the same way: the app says that there is nothing to open, and its address is `/share` alone, without the text. Android's share sheet can change its layout from one share to the next: check which app a tap picks before it, since another app may send the text.
- **L4. The Drive app.** Only if the developer chooses to install Drive from the Play Store, signed in with the test account; otherwise BLOCKED. Drive syncs only once Android clears its "Account access restricted", which a screen-lock PIN does: the developer sets one, and the screen timeout goes up so that the device does not lock mid-check. Its **Send a copy** shares the file, for which Android does not offer DriveMD; its **Copy link** gives an address that opens the note once pasted in the app's search box; and its **Open with** offers DriveMD, which opens production: close that tab untouched. The spec's share target requirement says so of Drive 2.26: record what changed.

### M. Android's Back (Android)

In Samsung Internet, a tab that an intent opened, such as `mobile_open_url`'s, has no page before its first one, so Back from there leaves the browser (M1, M3): count it as Back reaching the page before.

- **M1. Folders.** From Home, open My Drive, then a folder in it, then one in that: Back steps back through each, to Home.
- **M2. A note.** Open a note from a folder, then Back: the folder shows again, at the item opened.
- **M3. Unsaved changes.** Edit a note without saving, then Back, twice if the keyboard is up: the note leaves without asking, as the spec says of the browser's Back, and Home lists it under **Unsaved changes**. Open it from there and choose **Discard**.
- **M4. Out of the app.** In the installed app, Back on Home leaves the app for the launcher, and its icon brings it back where it was. In a Chrome tab, Back on Home goes to the page before it.

## Report

`report.md` holds, in this order:

1. The run: date, staging's version, Xcode, the iOS runtime, the devices, and what could not be set up; on Android, the versions that Version names.
2. A table of every check, by device and context: the check, its verdict, and the screenshots.
3. For each FAIL: the steps, what was expected, what showed, and the screenshots; for each BLOCKED, why, and what a real device should check.
4. The checks a real iPhone or iPad must repeat, and why: section K's, K4 to K10, K14, K19, K20, K25 and K26 at least, and any other whose result rests on the Simulator's text input.
5. The mockups: a verdict for each, and its differences.
6. Draft issues for the FAILs, one per defect, each with a title in the repository's style (a sentence saying what the app should do), the steps and the device, and no screenshot that shows the account's email.
