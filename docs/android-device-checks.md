# Device checks on Android

The end-to-end tests run Playwright's Chromium with a phone's screen, and the live checks run the deployed app the same way. Neither has Android itself: Chrome's bars, Gboard, the camera's cutout and the gesture bar, Android's Back, the installed app, the share sheet or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the Android Emulator, and readable by a person with a real phone. It follows [`apple-device-checks.md`](apple-device-checks.md), and says only where Android differs. Run it on staging before a milestone that changes the interface closes, and before a release reaches production.

## Rules for the agent

The rules of [`apple-device-checks.md`](apple-device-checks.md#rules-for-the-agent) apply as written, with Chrome for Safari and the emulator for the Simulator, and these on top:

- **Accounts on the device.** Add no Google account to Android (Settings ▸ Passwords & accounts) or to Chrome yourself. The installed app needs the Play Store (E1), whose sign-in adds the test account to Android: the developer signs in there, as in the app. Nothing else needs an account on the device, but the Drive app of L4, if the developer chooses to install it.
- **The developer runs DevTools.** When a value from the page is needed, ask the developer to open `chrome://inspect#devices` in Chrome on the Mac, inspect the emulator's tab or the installed app, and run what you give them. Do not connect to Chrome's debugging port yourself (`adb forward … chrome_devtools_remote`): it reaches the page's tokens.
- **Logs.** `mobile_get_device_logs` reads logcat, which holds the account's email and Google's tokens as iOS's log does: the same rule applies.

## Setup

Set up the Mac, the emulator's devices and the tools as [`device-setup-android.md`](device-setup-android.md) says, which also says what to do when a tool, a device or the emulator fails.

### Output and version

Write the report and the screenshots as [`apple-device-checks.md`](apple-device-checks.md#output) says, in a folder of their own, such as `~/drivemd-device-checks/<date>-android/`, with `phone` and `tablet` for the device and `chrome`, `app` or `samsung` for the context: `C2-phone-chrome-left-light.png`. At the report's top, write staging's version (`version.json`), the date, the emulator's version, the API level and the devices, and the versions of Chrome and Gboard (`adb -s <serial> shell dumpsys package com.android.chrome | grep versionName`, and `com.google.android.inputmethod.latin`). An image's Chrome can be months old, and nothing updates it without the Play Store: say so in the report when it is older than Chrome's stable release.

### Notes for the checks

The four `device-check-*` notes of [`apple-device-checks.md`](apple-device-checks.md#notes-for-the-checks), made from the app on the phone after check A1. For the long note, run its command without `| xcrun simctl pbcopy …`, and give its output to `mobile_clipboard`.

## Order

1. Phone, Chrome: A, B, C, D, G, H, J, K, M.
2. Phone, installed app: E, then C, D and M again in it, with K3, K5, K9 and K10, and L.
3. Tablet, Chrome: A, C, D, G, K.
4. Tablet, installed app: E, then C and D again in it.
5. Phone, Samsung Internet, installed from the Play Store, which the developer signed in to for E1: A, D and M, with K3, K5, K9 and K10.
6. Both devices, both themes: F.
7. I, only if staging deploys a new version during the run.

On each device, D6 comes first, in Chrome, before Gboard's full keyboard has ever come up (see Typing, under [Tools](device-setup-android.md#tools)): on the phone, before C5, whose D1 to D3 bring the full keyboard up. The first time the editor opens on a device, check K1's default, **Edit** opening Visual, before section D picks Source, which the device then remembers. Run every check in the light theme, unless it says otherwise: E3, section F, H2 and K17 also run the dark one, after which the device goes back to light (`adb -s <serial> shell cmd uimode night no`).

## Checks

Sections A, F, G, H and I are those of [`apple-device-checks.md`](apple-device-checks.md#checks), with Chrome for Safari, the tablet for the iPad and the installed app for the Home Screen app; this section says what changes in them, and in section K, and holds the others in full.

### A. Sign-in and version

As on iOS. Google's sign-in opens in a Chrome window of its own, or in a tab, over the app; once done, it comes back to the app's tab.

### B. No Add to Home Screen banner

- **B1.** Home shows no **Add DriveMD to your Home Screen** banner, before sign-in nor after: the banner is for iOS. Record, as information, whether Chrome offers its own install prompt or an install icon in its address bar.

### C. Safe areas

On each screen of [section C](apple-device-checks.md#c-safe-areas) of the iOS checks, with the phone for the iPhone and the tablet for the iPad.

- **C1. Upright.** No text, icon or control sits under the status bar, the camera's cutout or the gesture bar, nor in the screen's rounded corners. The bars' and pages' backgrounds run to the screen's edges, or to Chrome's own bars, with no band of another color.
- **C2. Sideways, both ways** (`user_rotation` 1, then 3 on the phone; 0, then 2 on the tablet): the same, with content kept clear of the cutout's side, while the bars' backgrounds still run under it. On the phone, the layout stays the phone's.
- **C3. Scrolled.** On the long note and on a folder with more items than the screen holds, scrolled to the end: the last line and the last item come fully above the gesture bar.
- **C4. Three buttons.** With the navigation's three buttons instead of the gesture bar, C1 and C3 again: nothing sits under the buttons' bar, and no empty band shows where the gesture bar was. On the tablet, the three buttons come in Android's taskbar, apps first. Switch back to gestures.
- **C5. Address bar at the bottom** (phone, Chrome): with Chrome's address bar at the screen's bottom (Chrome ▸ Settings ▸ Address bar), C1 and C3 again, and D1 to D3 in section D, after D6 (see Order). Put it back at the top.

### D. The keyboard toolbar

With Gboard's full keyboard, but for D6. Open `device-check-long.md`, then **Edit** ▸ **Source**, or on the tablet the mode menu ▸ **Source**. Run D1 to D7 of [section D](apple-device-checks.md#d-the-keyboard-toolbar) of the iOS checks, with these changes:

- **D1.** The toolbar sits right on Gboard, which has no address bar floating above it: no gap, no overlap with Gboard's own row of suggestions.
- **D2.** Run it twice: with Gboard up before the tap at the note's end, then with Gboard down (Back) before it, so that the tap brings Gboard up.
- **D3.** Delete with Gboard's delete key. Whatever Save shows, record it; issue #202 was seen on iOS alone.
- **D5.** Select the word with a long press, which the emulator does.
- **D6. Hardware keyboard.** First, before Gboard's full keyboard has come up on the device: tap the text. Only Gboard's floating ≡ shows, and the toolbar sits at the screen's bottom, over the gesture bar, one row tall. Then Alt+K brings up the full keyboard for the rest. Wherever the full keyboard has come up before, it is BLOCKED, and in the installed app too: once the Play Store has installed it, Gboard restarts and brings its full keyboard up at each tap in a field, in Chrome as in the app, a letter typed folding it to the ≡ only until the next tap (Gboard 18.0.3, seen on a wiped emulator on 2026-10-25, [#289](https://github.com/edgeweave-loom/drivemd/issues/289)). It takes a real phone with a hardware keyboard.
- **D8. Back hides the keyboard.** With the keyboard up, press Back once: the keyboard goes, the note stays, and the toolbar moves to the screen's bottom, over the gesture bar, or in Samsung Internet onto its bottom bar, as the spec says. Tap the text: the keyboard and the toolbar come back together.
- **D9. Samsung keyboard.** BLOCKED: the emulator has no Samsung keyboard, which comes only on Samsung's phones.

Then take back the edits with Undo, and pick Visual again, before leaving the editor.

### E. The installed app

- **E1. Install.** In Chrome, on a note's page, tap ⋮ ▸ **Add to home screen** ▸ **Install** (or **Install app**). The dialog offers the name **DriveMD** and DriveMD's mark, not a picture of the page. Chrome makes the app through the Play Store: while the Play Store has no account, Chrome makes a shortcut instead, with Chrome's badge on the icon. Then ask the developer to sign in to the Play Store, which adds the test account to Android; remove the shortcut and install again. Once installed, the launcher shows the mark cut to its own shape, a circle on a Pixel, with the whole mark inside. If the developer chooses not to sign in, record it, run E with the shortcut, and mark L BLOCKED.
- **E2. Launch.** The icon opens the app in a window of its own, without Chrome's bars, on Home rather than the note. The launch screen before the page is light, the manifest's background, with the mark. Each launch may ask **Continue** (see Continue, under [Tools](device-setup-android.md#tools)). When the launcher has moved the icon, launch the app with `adb -s <serial> shell monkey -p <package> -c android.intent.category.LAUNCHER 1`, its package from `adb -s <serial> shell pm list packages | grep webapk`.
- **E3. Status bar.** The status bar and the gesture bar's band take the page's background, in the light and the dark theme. On the tablet, Chrome paints both bands itself, as the spec's Home Screen app requirement says: record their colors, and the same in C and D8 in the installed app, as Chrome's rather than failures.
- **E4. Its own app.** Overview lists DriveMD as an app of its own, with its name and its mark, apart from Chrome; Settings ▸ Apps lists it too.
- **E5. No banner.** Home shows no Add to Home Screen banner.
- Then run sections C and D again in the app, and on the phone M, K3, K5, K9 and K10.

### F. The mockups

As [section F](apple-device-checks.md#f-the-mockups) of the iOS checks says, with the phone for the iPhone and the tablet for the iPad; for the conflict, open `device-check-other.md` in two Chrome tabs. `drive-tab-sign-in` and `drive-tab-phone-sign-in` show before sign-in, in a tab that Drive opened with an account: type `/open?state=` in a Chrome tab's address bar, followed by the URL-encoded `{"ids":["<id>"],"action":"open","userId":"<digits>"}`, with a test note's ID and made-up digits, and the tab signs in afresh, with the account the device remembers left alone. An address that an intent or a link opens goes to the installed app instead, even with its links turned off.

### G. A tab opened from Drive

As [section G](apple-device-checks.md#g-a-tab-opened-from-drive) of the iOS checks says, in Chrome. Drive in Chrome on a phone may offer its app first: tap to stay in the browser.

- **G1.** Drive's mobile site has no **Open with**: switch Chrome to ⋮ ▸ **Desktop site**, where a long press on the file offers it. Drive's **Open with ▸ DriveMD** opens production, the only DriveMD that Drive knows: close that tab untouched, and open the address that G1 builds when Drive does not offer DriveMD, on staging.
- **G2.** Run it in an Incognito tab, from ⋮ ▸ **New Incognito tab**; on the tablet, Ctrl+Shift+N opens a second window instead, side by side, which ⋮ ▸ **Manage windows** closes. Chrome keeps Incognito out of screenshots: read the page from its elements.
- **G4.** The new tab is one of Chrome's, with the app installed from E1: not the installed app, which would ask **Continue** (see Handing the token to a new tab in the spec). Check first that Android lets the app take staging's links, or the note stays in Chrome whatever the app does: `adb -s <serial> shell pm get-app-links <package>` must say `verified` for staging's domain. After a boot it said `1024`, a failed check, until `adb -s <serial> shell pm verify-app-links --re-verify <package>` (seen on 2026-10-24).

### H. Home and themes

As [section H](apple-device-checks.md#h-home-and-themes) of the iOS checks says, with `adb -s <serial> shell cmd uimode night yes` for the dark appearance.

### I. A new version (only if staging deploys during the run)

As [section I](apple-device-checks.md#i-a-new-version-only-if-staging-deploys-during-the-run) of the iOS checks says, with the installed app sent to the background with Home.

### J. Typed text, as information

- **J1.** In the editor, tap on Gboard's keys: `"quoted" -- it's` and a new line starting with `next`. After the apostrophe, Gboard goes back to its letters by itself. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, no corrected word, and no capital on `next`.
- **J2.** Type a word, then two spaces with quick taps on the space bar. Gboard turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.

### K. Visual, Source and Viewing (v2, stage 1)

Run K1 to K20 of [section K](apple-device-checks.md#k-visual-source-and-viewing-v2-stage-1) of the iOS checks on `device-check-visual.md`, with the phone for the iPhone, the tablet for the iPad and Chrome for Safari, typing on Gboard's keys, with the changes and the checks below. Gboard sends what it types through composition: it holds the word being typed as marked text, which it may rewrite as it goes, where iOS does that only for Japanese or Chinese. Visual changes a line's text as the cursor enters it, so these checks watch for letters or symbols lost, doubled or moved. The emulator runs Gboard itself, so it stands for a phone here, as it did for milestone 8: the report says which checks a real phone must repeat, if any, and why.

- **K1.** Section D picks Source, which the device remembers: the default, **Edit** opening Visual, is checked before D (see Order). On the tablet, the mode menu offers **Visual**, **Source** and **Viewing** upright and sideways.
- **K4, K5.** Tap inside "bold words", record whether Gboard underlines a word, then type `tea` on Gboard's keys: the letters land at the cursor, once each and in order, and the line's `**` stay where they were. Then K5 as written.
- **K6.** Move the cursor with the handle that Chrome shows under it after a tap, and by sliding on Gboard's space bar, BLOCKED if the emulator's swipe cannot slide there.
- **K7.** A long press on "italic" selects it, with Chrome's handles and menu.
- **K8.** With Gboard's delete key.
- **K9.** "The keyboard down" means the editor without the focus: pick Preview, then Visual (phone), or Viewing, then Visual (tablet), before tapping the box. With Gboard hidden by Back, the editor keeps the focus, which K22 checks.
- **K10, K11.** In the installed app, the other note opens in the app; record where the web page opens, over the app (a Custom Tab) or in Chrome. A long press on "a web page" selects a word, and Chrome's menu for links (**Open in new tab**, …) does not show.
- **K12.** J1 and J2 above.
- **K13.** With Gboard's microphone: BLOCKED unless the developer turns on the emulator's ⋯ ▸ Microphone ▸ **Virtual microphone uses host audio input** and speaks.
- **K14.** With Gboard's Japanese keyboard, in its QWERTY layout, and its Chinese (Pinyin) one, added from Gboard's settings ▸ Languages. Gboard's Pinyin keeps the typed letters in its own bar by default (**Inline composing** off), so the page shows no marked text for it: check that the candidate lands once.
- **K18.** With arrow keys sent through `adb`: `adb -s <serial> shell input keyevent KEYCODE_DPAD_DOWN`, and `input keycombination KEYCODE_SHIFT_LEFT KEYCODE_DPAD_DOWN` to select.
- **K19. Gboard's suggestions.** If Gboard shows suggestions over its keys while typing in the paragraph, pick one: it replaces the word being typed, once, and nothing around it. The editor turns spellcheck off, so Gboard may show none: record which.
- **K20. Return and delete.** At the end of "An open task", tap Gboard's Return: a new line starts with `- [ ] `, as Return does in Source. Tap delete until the cursor is back after "An open task": the markup goes as it does in Source, and the note is as before. Then hold delete over a few words of the paragraph: the letters go one at a time, none twice, and the `**` go only once the cursor reaches them.
- **K21. A tick while composing.** Type `gre` in the paragraph, without a space, then tap the open task's box: it ticks, and `gre` stays, once. Type `en`: the word reads `green`. Tap the box again, so that K22 finds it open.
- **K22. Back.** With Gboard up and the cursor in the paragraph, press Back: Gboard goes, and the editor keeps the focus, as D8 says; record whether the paragraph keeps its symbols shown. Tap the open task's box: it ticks, and Gboard stays down.

Then tap Undo until Save reads **Saved**, so that K19 to K22, which come after K16's save, leave no unsaved changes for the next context.

### L. The share target (installed app, phone)

Take `device-check-tasks.md`'s ID from the app's `/edit?id=<ID>` address, as `ID=<ID>` in the Mac's shell.

- **L1. From Chrome.** In a Chrome tab on that note's page, tap ⋮ ▸ **Share**: the share sheet offers DriveMD, with its mark. Pick it: the note opens in the installed app.
- **L2. A Drive link with words around it.** Share a text holding a Drive link: `adb -s <serial> shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'See <https://drive.google.com/file/d/$ID/view>, it is there.'"`, and pick DriveMD in what Android offers. The note opens; Back leaves for the launcher rather than to `/share`, and a reload keeps the note.
- **L3. No link.** Share a text without a link the same way: the app says that there is nothing to open, and its address is `/share` alone, without the text. Android's share sheet can change its layout from one share to the next: check which app a tap picks before it, since another app may send the text.
- **L4. The Drive app.** Only if the developer chooses to install Drive from the Play Store, signed in with the test account; otherwise BLOCKED. Drive syncs only once Android clears its "Account access restricted", which a screen-lock PIN does: the developer sets one, and the screen timeout goes up so that the device does not lock mid-check. Its **Send a copy** shares the file, for which Android does not offer DriveMD; its **Copy link** gives an address that opens the note once pasted in the app's search box; and its **Open with** offers DriveMD, which opens production: close that tab untouched. The spec's share target requirement says so of Drive 2.26: record what changed.

### M. Android's Back

In Samsung Internet, a tab that an intent opened, such as `mobile_open_url`'s, has no page before its first one, so Back from there leaves the browser (M1, M3): count it as Back reaching the page before.

- **M1. Folders.** From Home, open My Drive, then a folder in it, then one in that: Back steps back through each, to Home.
- **M2. A note.** Open a note from a folder, then Back: the folder shows again, at the item opened.
- **M3. Unsaved changes.** Edit a note without saving, then Back, twice if the keyboard is up: the note leaves without asking, as the spec says of the browser's Back, and Home lists it under **Unsaved changes**. Open it from there and choose **Discard**.
- **M4. Out of the app.** In the installed app, Back on Home leaves the app for the launcher, and its icon brings it back where it was. In a Chrome tab, Back on Home goes to the page before it.

## Report

As [`apple-device-checks.md`](apple-device-checks.md#report) says, with the run's versions of Output and version above.
