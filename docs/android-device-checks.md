# Device checks on Android

The end-to-end tests run Playwright's Chromium with a phone's screen, and the live checks run the deployed app the same way. Neither has Android itself: Chrome's bars, Gboard, the camera's cutout and the gesture bar, Android's Back, the installed app, the share sheet or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the Android Emulator, and readable by a person with a real phone. It follows [`apple-device-checks.md`](apple-device-checks.md), and says only where Android differs. Run it on staging before a milestone that changes the interface closes, and before a release reaches production.

## Rules for the agent

The rules of [`apple-device-checks.md`](apple-device-checks.md#rules-for-the-agent) apply as written, with Chrome for Safari and the emulator for the Simulator, and these on top:

- **No account on the device.** Add no Google account to Android (Settings ▸ Passwords & accounts) or to Chrome (its first run's **Use without an account**), and do not sign in to the Play Store unless the developer chooses to, for E1: the test account signs in to the app alone, in Google's window. When a check needs more, such as the Drive app, it is BLOCKED, for a real phone.
- **The developer runs DevTools.** When a value from the page is needed, ask the developer to open `chrome://inspect#devices` in Chrome on the Mac, inspect the emulator's tab or the installed app, and run what you give them. Do not connect to Chrome's debugging port yourself (`adb forward … chrome_devtools_remote`): it reaches the page's tokens.
- **Logs.** `mobile_get_device_logs` reads logcat, which holds the account's email and Google's tokens as iOS's log does: the same rule applies.

## Setup

### Devices

Use the newest Android version that the SDK offers with Google Play, beta and canary left aside (`android sdk list --all | grep google_apis_playstore`), such as `system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a`; the newest come only with 16 KB pages (`_ps16k`). Chrome installs a web app as an app of its own, a WebAPK, which the share target needs, through the Play Store, which the `default` and `google_apis` images lack. When the image has no Gboard, section D runs with its keyboard, which the report names.

| Name             | Device (`avdmanager list device`) | Why                                                                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DriveMD_Phone`  | `pixel_9`, 411 × 923 dp           | the camera's cutout, the gesture bar, the phone layout upright and sideways (411 dp tall, under 500, so it keeps the phone layout)    |
| `DriveMD_Tablet` | `pixel_tablet`, 1280 × 800 dp     | upright, 800 dp wide: the navigation rail and the folder's drawer; sideways, 1280 dp: the navigation drawer and the computer's layout |

Create each one fresh for a run, so that no installed app, `localStorage` or Google session is left from the last one:

```sh
IMAGE="system-images;android-<version>;google_apis_playstore_ps16k;arm64-v8a"
avdmanager delete avd -n DriveMD_Phone
echo no | avdmanager create avd -n DriveMD_Phone -k "$IMAGE" -d pixel_9
echo hw.keyboard=yes >> ~/.android/avd/DriveMD_Phone.avd/config.ini
emulator -avd DriveMD_Phone -no-snapshot -no-boot-anim &
adb -s emulator-5554 wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
```

The tablet is the same with `pixel_tablet`; booted second, it is `emulator-5556` (`adb devices` lists them). `hw.keyboard=yes` passes the Mac's keyboard to the device, for D6, while `show_ime_with_hard_keyboard` keeps the on-screen keyboard for the rest (see Typing, under Tools). Give the status bar a fixed time and battery, so that screenshots compare:

```sh
adb -s <serial> shell settings put global sysui_demo_allowed 1
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command enter
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
```

The phone must show its camera's cutout in screenshots: when it shows none, turn on Android's own (`adb -s <serial> shell cmd overlay enable com.android.internal.display.cutout.emulation.hole`). On a new device, Chrome's first run asks to sign in and to pick a search engine: tap **Use without an account**, then any engine.

### Install

Once per Mac, besides Node.js 24, pnpm, uv and mobile-mcp, as [`apple-device-checks.md`](apple-device-checks.md#install) says:

- The Android SDK in `~/Library/Android/sdk`, where mobile-mcp looks for `adb` unless `ANDROID_HOME` says otherwise, with its command-line tools in `cmdline-tools/latest`: from Android Studio's **Settings ▸ Languages & Frameworks ▸ Android SDK ▸ SDK Tools**, **Android SDK Command-line Tools (latest)**, or without Android Studio, the archive that Google's repository (`https://dl.google.com/android/repository/repository2-3.xml`) lists for `cmdline-tools;latest` and `macosx`, checked against its SHA-1 there and unzipped. Then install the emulator, `adb` and the image with the Android CLI, which replaces `sdkmanager`: `android sdk install emulator platform-tools "$IMAGE"`. Its `android` command is a launcher that fetches the CLI's newest version into `~/.android/cli`, which no file pins. Leave the Android tools' usage statistics off (`"hasOptedIn":false` in `~/.android/analytics.settings`).
- `avdmanager`, which the devices still need since `android emulator create` takes no device type, image or name, runs on Java 17 or newer: when `java -version` says older, use Android Studio's, `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Put `~/Library/Android/sdk/platform-tools`, `emulator` and `cmdline-tools/latest/bin` on the `PATH`.

Before the first check, the agent checks these with `adb version`, `emulator -version`, `android sdk list`, `node -v`, `pnpm -v`, `uv --version` and whether the `mobile` tools are available, and tells the developer what is missing. `mobile_list_available_devices` also lists a phone plugged into the Mac: use only the emulators' serials.

### Tools

- **mobile-mcp** works as on iOS (see [Tools](apple-device-checks.md#tools)), through `adb`, and `mobile_press_button` also presses `BACK`. `mobile_save_screenshot` writes only under the working directory or the temporary one: save the report's screenshots with `adb -s <serial> exec-out screencap -p > <path>` instead.
- `adb` does the rest: the theme (`shell cmd uimode night yes|no`), the orientation (`shell settings put system accelerometer_rotation 0`, then `shell settings put system user_rotation 0|1|2|3`, a quarter turn each from the device's natural orientation, which is upright on the phone and sideways on the tablet: the tablet stands upright at 1 and 3; `mobile_set_orientation` knows only 0 and 1), the navigation (`shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural`, or `threebutton`), and Back (`shell input keyevent KEYCODE_BACK`).
- **The emulator's window** has its own side bar: Back, Home, Overview, Rotate, and **⋯** for the extended controls.
- **The clipboard.** The emulator copies the Mac's clipboard into the device (**⋯ ▸ Settings ▸ General ▸ Enable clipboard sharing**): a paste can bring in whatever the Mac holds, such as a sign-in code. Turn that off, or set the device's clipboard with `mobile_clipboard` right before each paste, and check what was pasted before saving.
- **Typing and the on-screen keyboard.** With `hw.keyboard=yes`, Android shows Gboard only while `adb -s <serial> shell settings put secure show_ime_with_hard_keyboard 1` is set: set it before section D, and to `0` for D6 alone; take a screenshot to see which keyboard shows. `mobile_type_keys` types through `adb shell input text`, ASCII only, as a hardware keyboard does: Gboard stays up, but its autocorrect, capitals and double-space period never see the keys, so J needs Gboard's own keys. A long press selects a word, as on a phone.
- **Measuring.** Screenshots are in pixels: 2.625 per dp on the phone and 2 on the tablet (`adb -s <serial> shell wm density`, divided by 160). Measure gaps and overlaps on them with a short script (`uv run --with pillow python …`).

### Output and version

Write the report and the screenshots as [`apple-device-checks.md`](apple-device-checks.md#output) says, in a folder of their own, such as `~/drivemd-device-checks/<date>-android/`, with `phone` and `tablet` for the device and `chrome` or `app` for the context: `C2-phone-chrome-left-light.png`. At the report's top, write staging's version (`version.json`), the date, the emulator's version, the API level and the devices, and the versions of Chrome and Gboard (`adb -s <serial> shell dumpsys package com.android.chrome | grep versionName`, and `com.google.android.inputmethod.latin`). An image's Chrome can be months old, and nothing updates it without the Play Store: say so in the report when it is older than Chrome's stable release.

### Notes for the checks

The three `device-check-*` notes of [`apple-device-checks.md`](apple-device-checks.md#notes-for-the-checks), made from the app on the phone after check A1. For the long note, run its command without `| xcrun simctl pbcopy …`, and give its output to `mobile_clipboard`.

## Order

1. Phone, Chrome: A, B, C, D, K, G, H, J.
2. Phone, installed app: E, then C, D and K again in it, and L.
3. Tablet, Chrome: A, C, D, G.
4. Tablet, installed app: E, then C and D again in it.
5. Both devices, both themes: F.
6. I, only if staging deploys a new version during the run.

Run every check in the light theme, unless it says otherwise: E3, section F and H2 also run the dark one, after which the device goes back to light (`adb -s <serial> shell cmd uimode night no`).

## Checks

Sections A, F, G, H and I are those of [`apple-device-checks.md`](apple-device-checks.md#checks), with Chrome for Safari, the tablet for the iPad and the installed app for the Home Screen app; this section says what changes in them, and holds the others in full.

### A. Sign-in and version

As on iOS. Google's sign-in opens in a Chrome window of its own, or in a tab, over the app; once done, it comes back to the app's tab.

### B. No Add to Home Screen banner

- **B1.** Home shows no **Add DriveMD to your Home Screen** banner, before sign-in nor after: the banner is for iOS. Record, as information, whether Chrome offers its own install prompt or an install icon in its address bar.

### C. Safe areas

On each screen of [section C](apple-device-checks.md#c-safe-areas) of the iOS checks, with the phone for the iPhone and the tablet for the iPad.

- **C1. Upright.** No text, icon or control sits under the status bar, the camera's cutout or the gesture bar, nor in the screen's rounded corners. The bars' and pages' backgrounds run to the screen's edges, or to Chrome's own bars, with no band of another color.
- **C2. Sideways, both ways** (`user_rotation` 1, then 3 on the phone; 0, then 2 on the tablet): the same, with content kept clear of the cutout's side, while the bars' backgrounds still run under it. On the phone, the layout stays the phone's.
- **C3. Scrolled.** On the long note and on a folder with more items than the screen holds, scrolled to the end: the last line and the last item come fully above the gesture bar.
- **C4. Three buttons.** With the navigation's three buttons instead of the gesture bar, C1 and C3 again: nothing sits under the buttons' bar, and no empty band shows where the gesture bar was. Switch back to gestures.
- **C5. Address bar at the bottom** (phone, Chrome): with Chrome's address bar at the screen's bottom (Chrome ▸ Settings ▸ Address bar), C1 and C3 again, and D1 to D3 in section D. Put it back at the top.

### D. The keyboard toolbar

With Gboard (`show_ime_with_hard_keyboard` 1). Open `device-check-long.md`, then **Edit**, or on the tablet the mode menu ▸ **Editing**. Run D1 to D7 of [section D](apple-device-checks.md#d-the-keyboard-toolbar) of the iOS checks, with these changes:

- **D1.** The toolbar sits right on Gboard, which has no address bar floating above it: no gap, no overlap with Gboard's own row of suggestions.
- **D3.** Delete with Gboard's delete key. Whatever Save shows, record it; issue #202 was seen on iOS alone.
- **D5.** Select the word with a long press, which the emulator does.
- **D6.** With `show_ime_with_hard_keyboard` 0, tap the text: no on-screen keyboard shows, and the toolbar sits at the screen's bottom, over the gesture bar, one row tall. Set it back to 1.
- **D8. Back hides the keyboard.** With the keyboard up, press Back once: the keyboard goes, the note stays, and the toolbar moves to the screen's bottom, over the gesture bar, as the spec says. Tap the text: the keyboard and the toolbar come back together.
- **D9. Samsung keyboard.** BLOCKED: the emulator has no Samsung keyboard, which the spec asks to check too, on a Samsung phone.

Then take back the edits with Undo before leaving the editor.

### E. The installed app

- **E1. Install.** In Chrome, on a note's page, tap ⋮ ▸ **Add to home screen** ▸ **Install** (or **Install app**). The dialog offers the name **DriveMD** and DriveMD's mark, not a picture of the page. Once installed, the launcher shows the mark cut to its own shape, a circle on a Pixel, with the whole mark inside. If Chrome makes a shortcut instead, with Chrome's badge on the icon, there is no WebAPK: record it, and ask the developer whether to sign in to the Play Store and install again; otherwise mark L BLOCKED.
- **E2. Launch.** The icon opens the app in a window of its own, without Chrome's bars, on Home rather than the note. The launch screen before the page is light, the manifest's background, with the mark. If it asks to sign in or to **Continue**, the developer does.
- **E3. Status bar.** The status bar and the gesture bar's band take the page's background, in the light and the dark theme.
- **E4. Its own app.** Overview lists DriveMD as an app of its own, with its name and its mark, apart from Chrome; Settings ▸ Apps lists it too.
- **E5. No banner.** Home shows no Add to Home Screen banner.
- Then run sections C, D and, on the phone, K again in the app.

### F. The mockups

As [section F](apple-device-checks.md#f-the-mockups) of the iOS checks says, with the phone for the iPhone and the tablet for the iPad; for the conflict, open `device-check-other.md` in two Chrome tabs.

### G. A tab opened from Drive

As [section G](apple-device-checks.md#g-a-tab-opened-from-drive) of the iOS checks says, in Chrome: G2 runs in an Incognito tab (⋮ ▸ **New Incognito tab**), and G4's new tab is one of Chrome's. Drive in Chrome on a phone may offer its app first: tap to stay in the browser.

### H. Home and themes

As [section H](apple-device-checks.md#h-home-and-themes) of the iOS checks says, with `adb -s <serial> shell cmd uimode night yes` for the dark appearance.

### I. A new version (only if staging deploys during the run)

As [section I](apple-device-checks.md#i-a-new-version-only-if-staging-deploys-during-the-run) of the iOS checks says, with the installed app sent to the background with Home.

### J. Typed text, as information

- **J1.** In the editor, tap on Gboard's keys: `"quoted" -- it's` and a new line starting with `next`. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, no corrected word, and no capital on `next`.
- **J2.** Type a word, then two spaces with quick taps on the space bar. Gboard turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.

### K. Android's Back

- **K1. Folders.** From Home, open My Drive, then a folder in it, then one in that: Back steps back through each, to Home.
- **K2. A note.** Open a note from a folder, then Back: the folder shows again, at the item opened.
- **K3. Unsaved changes.** Edit a note without saving, then Back: the app asks "This note has unsaved changes. Leave it anyway?". Cancel keeps the note and its changes; then take them back with Undo.
- **K4. Out of the app.** In the installed app, Back on Home leaves the app for the launcher, and its icon brings it back where it was. In a Chrome tab, Back on Home goes to the page before it.

### L. The share target (installed app, phone)

Take `device-check-tasks.md`'s ID from the app's `/edit?id=<ID>` address, as `ID=<ID>` in the Mac's shell.

- **L1. From Chrome.** In a Chrome tab on that note's page, tap ⋮ ▸ **Share**: the share sheet offers DriveMD, with its mark. Pick it: the note opens in the installed app.
- **L2. A Drive link with words around it.** Share a text holding a Drive link: `adb -s <serial> shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'See <https://drive.google.com/file/d/$ID/view>, it is there.'"`, and pick DriveMD in what Android offers. The note opens; Back leaves for the launcher rather than to `/share`, and a reload keeps the note.
- **L3. No link.** Share a text without a link the same way: the app says that there is nothing to open, and its address is `/share` alone, without the text.
- **L4. The Drive app.** BLOCKED: whether the Drive app shares a link, rather than a copy of the file, needs a phone with the Drive app signed in.

## Report

As [`apple-device-checks.md`](apple-device-checks.md#report) says, with the run's versions of Output and version above.
