# Device checks on iPhone and iPad

The end-to-end tests run Playwright's WebKit with an iPhone's and an iPad's screen, and the live checks run the deployed app the same way. Neither has iOS itself: Safari's bars, the on-screen keyboard, the notch and the home bar, the Home Screen app or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the iOS Simulator, and readable by a person with a real device. Run it on staging before a milestone that changes the interface closes, and before a release reaches production.

## Rules for the agent

- **Report, do not fix.** Run the checks and write the report. Do not change the app's code, do not file issues and do not push anything: draft the issues in the report, for the developer to file.
- **Staging only.** Check `https://md-staging.corp.edgeweave.tech`, or the address the developer gives, never production unless asked.
- **The test account only.** The developer signs in. Never type, read or keep a password or a code, and take no screenshot of Google's sign-in pages. The account's email shows in the app, and in the account button's label that `mobile_list_elements_on_screen` returns: write `<test account>` in the report instead, and keep screenshots out of the repository and of any upload, since they show its name.
- **Logs only to explain a failure.** The device's logs (`mobile_get_device_logs`) can hold the account's email and Google's tokens. Collect them only to explain a FAIL, narrowed with `filter` and `limit`, into the output folder. Quote in the report only the lines the verdict needs, with `<test account>` for the email and no token. Screen recordings show the email, as screenshots do.
- **Touch only the check's files.** Create, edit and trash only the `device-check-*` notes below, in the test account's My Drive.
- **One verdict per check:** PASS, FAIL (what was expected, what showed, and the screenshot), or BLOCKED (what the Simulator could not do, and what a real device should check instead). A known limit that the spec describes is a PASS with a note, not a FAIL.
- **Ask the developer** whenever Google asks for credentials, when macOS asks for a permission, and when a check needs something the Simulator lacks. The Simulator has no Bluetooth, so Google's 2-Step Verification cannot use the developer's phone as a security key: they pick another way, such as the prompt on their phone, an authenticator code or a backup code, without copying the code on the Mac (see the clipboard, under Tools).

## Setup

### Devices

Use the newest iOS runtime that Xcode has (`xcrun simctl list runtimes`) and these devices, from `xcrun simctl list devicetypes`:

| Name                | Device type                                    | Why                                                                                                                                                    |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DriveMD iPhone`    | the newest iPhone Pro, with the Dynamic Island | the notch, the home bar, the phone layout upright and sideways (under 500 pt tall, so it keeps the phone layout)                                       |
| `DriveMD iPad`      | an iPad Air 11-inch, 820 × 1180 pt             | upright, between 768 and 1023 pt wide: the navigation rail and the folder's drawer; sideways, 1180 pt: the navigation drawer and the computer's layout |
| `DriveMD iPhone SE` | iPhone SE (3rd generation), optional           | a home button and no notch: no inset should leave an empty band                                                                                        |

Create each one fresh for a run, so that no Home Screen app, `localStorage` or Google session is left from the last one: `xcrun simctl delete "DriveMD iPhone"` if it exists, then `xcrun simctl create "DriveMD iPhone" <device type> <runtime>`, and `xcrun simctl boot` it. After an Xcode update, the first `simctl` command restarts CoreSimulator ("CoreSimulator detected version change"): run `xcrun simctl list devices` once before creating the devices. Open their windows in DeviceHub (see Tools) before opening Safari: DeviceHub, opened before the devices existed, showed none of them, and opening a booted device there restarted it, closing Safari. Give the status bar a fixed time and battery, so that screenshots compare: `xcrun simctl status_bar <device> override --time 9:41 --batteryState charged --batteryLevel 100`. A device can shut down during the run, for example when its window closes: `xcrun simctl list devices` shows it, and it needs `xcrun simctl boot` and the status bar override again.

### Install

Once per Mac:

- Xcode with an iOS runtime (Xcode ▸ Settings ▸ Components, or `xcodebuild -downloadPlatform iOS`), opened once to accept its license.
- Node.js 24, which the repository also runs on, and [uv](https://docs.astral.sh/uv/) for the measuring scripts: `brew install node@24 uv`, then `brew link node@24`, since Homebrew's `node` is a newer major version.
- [mobile-mcp](https://github.com/mobile-next/mobile-mcp), Claude Code's MCP server for the Simulator, which the repository's `.mcp.json` declares: when Claude Code offers to use it, accept `mobile`, then check with `/mcp` that it is connected. Whoever does not run these checks declines, and nothing is installed. `.mcp.json` turns its telemetry off, since it would otherwise send each tool call's name to its developers, and offer a tool that sends them what the agent writes in it. It pins a version at least a week old, as Dependabot's cooldown does, and Dependabot does not update it: raise it by hand. The server brings mobilecli, which drives the Simulator, and drives Android emulators too, through `adb`. mobilecli needs its agent on each new device: when a tool fails to start it, run `mobilecli agent install --device <device>` with the binary from npm's npx cache (`@mobilenext/mobilecli-darwin-arm64`). After a device boots, the agent can take a few seconds to answer. `mobile_list_available_devices` also lists an iPhone or iPad plugged into the Mac (`"type":"real"`): use only the simulators' IDs.

Before the first check, the agent checks these with `xcodebuild -version`, `xcrun simctl list runtimes`, `node -v`, `uv --version` and whether the `mobile` tools are available, and tells the developer what is missing.

### Tools

- **mobile-mcp** taps (`mobile_click_on_screen_at_coordinates`, `mobile_long_press_on_screen_at_coordinates`), swipes from a point in one of four directions (`mobile_swipe_on_screen`), types (`mobile_type_keys`), lists the screen's elements (`mobile_list_elements_on_screen`), presses Home (`mobile_press_button` with `HOME`, to send the Home Screen app to the background), opens addresses (`mobile_open_url`; on a fresh device, Safari's first one can stay on its start page or loading, while the address typed in the address bar loads), takes screenshots (`mobile_take_screenshot`) and fills the clipboard (`mobile_clipboard`). Tap an element by the reference that the list gives; otherwise, convert a screenshot's pixels with the mapping that comes with it. `mobile_save_screenshot` writes only under the working directory or the temporary one: save the report's screenshots with `xcrun simctl io <device> screenshot <path>` instead, so that none lands in the repository.
- `xcrun simctl` does the rest: the theme (`ui <device> appearance light|dark`), the status bar (`status_bar`) and the screenshots (`io <device> screenshot`).
- **The Simulator's window.** Xcode 27 has no Simulator app: its devices show in DeviceHub (`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`, `open -a` it by that path), one device to a window, picked in the window's sidebar. Its menus act on the device whose window is in front (`name of window 1` says which): **Device ▸ Orientation ▸ Portrait / Landscape Left / Landscape Right** (Xcode 27.1) or **Controls ▸ Rotate Left / Rotate Right** turn it, and **Device ▸ Keyboard ▸ Simulate Hardware Keyboard** and **Toggle Software Keyboard** switch the keyboard. In Xcode 27.1, a new device starts with Simulate Hardware Keyboard on, and the iPhone's Keyboard menu once offered Toggle Software Keyboard alone, which then shows or hides the on-screen keyboard while a field has the focus. In Xcode 27.0, the iPad's Keyboard menu offered only Toggle Software Keyboard and Controls no Rotate items, and the iPad switched to its hardware-keyboard mode by itself now and then. Earlier Xcode versions have the Simulator app, with **Device ▸ Rotate Left / Rotate Right** and **I/O ▸ Keyboard ▸ Connect Hardware Keyboard** (⇧⌘K) and **Toggle Software Keyboard** (⌘K). `mobile_set_orientation` knows only portrait and landscape, not the side, so C2 turns the device from the menus. Reach them with `osascript`, after bringing the app to the front, for example `osascript -e 'tell application id "com.apple.dt.Devices" to activate' -e 'tell application "System Events" to tell process "DeviceHub" to click menu item "Landscape Left" of menu "Orientation" of menu item "Orientation" of menu "Device" of menu bar 1'` (with the Simulator app, `process "Simulator"` and `menu item "Rotate Left" of menu "Device"`). Read whether a menu item is on from its `AXMenuItemMarkChar` attribute, ✓ when on. macOS asks the developer once to let the terminal control the computer (Privacy & Security ▸ Accessibility).
- **The clipboard.** DeviceHub copies the Mac's clipboard into the device (**Edit ▸ Use Shared Clipboard**): a paste can bring in whatever the Mac holds, such as a sign-in code. Turn that item off, or set the device's clipboard with `mobile_clipboard` right before each paste, and check what was pasted before saving.
- **Typing and the on-screen keyboard.** Every keyboard check but D6 needs the on-screen keyboard: turn Simulate Hardware Keyboard off, since a new device has it on, or, when the menu lacks it, use Toggle Software Keyboard once the editor has the focus, and take a screenshot to see which keyboard shows: `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false` has no effect on DeviceHub. `mobile_type_keys` types as a hardware keyboard does: iOS may hide the on-screen keyboard, it skips iOS's smart punctuation and capitals (so J1 needs the on-screen keys), and it can lose its first character when the field has just been focused. Take a screenshot after typing; if the on-screen keyboard went away, enter text by tapping its keys, or paste it (`mobile_clipboard`, then tap the cursor and **Paste**). The Simulator's double tap and long press do not select a word: D5's selection is then BLOCKED.
- **Measuring.** Screenshots are in pixels, 3 per point on an iPhone and 2 on an iPad. Measure gaps and overlaps on them with a short script (`uv run --with pillow python …`). When a value from the page is needed, such as `visualViewport` or a box's position, ask the developer to open Safari's **Develop ▸ Simulator** Web Inspector on the Mac and run what you give them.

### Output

Write everything to a folder outside the repository, such as `~/drivemd-device-checks/<date>/`: the report, `report.md`, and the screenshots, named `<check>-<device>-<context>-<orientation>-<theme>.png`, such as `C2-iphone-safari-left-light.png`.

### Version

Read the version that staging serves with `curl -s https://md-staging.corp.edgeweave.tech/version.json`, and write it at the top of the report, with the date, Xcode's version (`xcodebuild -version`), the iOS runtime and the devices. The account menu must show the same version (check A2).

### Notes for the checks

Make three made-up notes in the test account's My Drive, from the app on the iPhone, after check A1: on **My Drive**, tap **New note**, name it, then **Edit**, paste the text, and tap **Done**. When they exist from a previous run, paste their text again, so that each run starts from the same notes.

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

## Order

Run the sections in this order, so that each context is set up once:

1. iPhone, Safari: A, B, C, D, G, H, J.
2. iPhone, Home Screen app: E, then C and D again in it.
3. iPad, Safari: A, B, C, D, G.
4. iPad, Home Screen app: E, then C and D again in it.
5. Both devices, both themes: F.
6. I, only if staging deploys a new version during the run.

Run every check in the light theme unless it says otherwise: E3, section F and H2 also run the dark one. Once such a check ends, set the device back to light (`xcrun simctl ui <device> appearance light`) before the next one.

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

With the on-screen keyboard (**Simulate Hardware Keyboard** off in DeviceHub, **Connect Hardware Keyboard** off in the Simulator app; see Typing, under Tools). Open `device-check-long.md`, then **Edit**, or on the iPad the mode menu ▸ **Editing**.

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
| `drive-tab-sign-in`, `drive-tab-editing`, `drive-tab-viewing`                   | iPad sideways, a tab opened from Drive: before sign-in, in Editing with a change, then Viewing                    |

To make a conflict, open `device-check-other.md` in two Safari tabs (the second asks for **Continue**), add a line in the second and save it, then add another in the first and save: a banner says that someone changed the file, over the differences, with its choices. Choose **Keep the Drive version**, and confirm, to leave.

### G. A tab opened from Drive

- **G1. Open.** In Safari, open drive.google.com, where the developer signs in to Drive, find `device-check-tasks.md` and open it with DriveMD (**Open with ▸ DriveMD**). If Drive does not offer it there, build the address Drive would open instead: take the note's ID from the app's `/edit?id=<ID>` address, and open `https://md-staging.corp.edgeweave.tech/open?state=` followed by `{"ids":["<ID>"],"action":"open"}` encoded as a URL component; then say in the report that Drive's own part went unchecked.
- **G2. Before sign-in.** Run it in a Safari that never saw the account: once A1 has signed in, the tab shows **Welcome back** instead, so on the iPhone open the address in a private tab, and close it afterwards. The page says "Google Drive asked DriveMD to open a Markdown file. Sign in with your Google account to see it." with **Sign in**, which opens Google's account chooser.
- **G3. The note alone.** No search, no breadcrumbs, no Back and no folders; DriveMD's mark is no link. On the iPhone the note opens read, and More actions holds **Move**, **Move to trash**, the account's email, **About DriveMD** and **Sign out**. On the iPad sideways it opens in Editing, the source beside the preview.
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
- **J2.** Type a word, then two spaces with quick taps on the space bar. iOS turns them into a period and a space (issue #119): record what the source holds, and if the developer has the Web Inspector open, the `beforeinput` events' `inputType` and `data`, which the issue needs.

## Report

`report.md` holds, in this order:

1. The run: date, staging's version, Xcode, the iOS runtime, the devices, and what could not be set up.
2. A table of every check, by device and context: the check, its verdict, and the screenshots.
3. For each FAIL: the steps, what was expected, what showed, and the screenshots; for each BLOCKED, why, and what a real device should check.
4. The mockups: a verdict for each, and its differences.
5. Draft issues for the FAILs, one per defect, each with a title in the repository's style (a sentence saying what the app should do), the steps and the device, and no screenshot that shows the account's email.
