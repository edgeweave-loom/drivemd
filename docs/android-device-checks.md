# Device checks on Android

The end-to-end tests run Playwright's Chromium with a phone's screen, and the live checks run the deployed app the same way. Neither has Android itself: Chrome's bars, Gboard, the camera's cutout and the gesture bar, Android's Back, the installed app, the share sheet or Google's sign-in window. This document is the checklist for those, written for Claude Code on a Mac driving the Android Emulator, and readable by a person with a real phone. It follows [`apple-device-checks.md`](apple-device-checks.md), and says only where Android differs. Run it on staging before a milestone that changes the interface closes, and before a release reaches production.

## Rules for the agent

The rules of [`apple-device-checks.md`](apple-device-checks.md#rules-for-the-agent) apply as written, with Chrome for Safari and the emulator for the Simulator, and these on top:

- **Accounts on the device.** Add no Google account to Android (Settings ▸ Passwords & accounts) or to Chrome yourself. The installed app needs the Play Store (E1), whose sign-in adds the test account to Android: the developer signs in there, as in the app. Nothing else needs an account on the device, but the Drive app of L4, if the developer chooses to install it.
- **The developer runs DevTools.** When a value from the page is needed, ask the developer to open `chrome://inspect#devices` in Chrome on the Mac, inspect the emulator's tab or the installed app, and run what you give them. Do not connect to Chrome's debugging port yourself (`adb forward … chrome_devtools_remote`): it reaches the page's tokens.
- **Logs.** `mobile_get_device_logs` reads logcat, which holds the account's email and Google's tokens as iOS's log does: the same rule applies.

## Setup

### Devices

Use the newest Android version that the SDK offers with Google Play, beta and canary left aside (`android sdk list --all | grep google_apis_playstore`), such as `system-images;android-37.2;google_apis_playstore_ps16k;arm64-v8a`; the newest come only with 16 KB pages (`_ps16k`). Chrome installs a web app as an app of its own, a WebAPK, which the share target needs, through the Play Store, which the `default` and `google_apis` images lack. When the image has no Gboard, sections D and K run with its keyboard, which the report names.

| Name             | Device (`avdmanager list device`) | Why                                                                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DriveMD_Phone`  | `pixel_9`, 411 × 923 dp           | the camera's cutout, the gesture bar, the phone layout upright and sideways (411 dp tall, under 500, so it keeps the phone layout)    |
| `DriveMD_Tablet` | `pixel_tablet`, 1280 × 800 dp     | upright, 800 dp wide: the navigation rail and the folder's drawer; sideways, 1280 dp: the navigation drawer and the computer's layout |

Create each one fresh for a run, so that no installed app, `localStorage` or Google session is left from the last one:

```sh
IMAGE="system-images;android-<version>;google_apis_playstore_ps16k;arm64-v8a"
avdmanager delete avd -n DriveMD_Phone
echo no | avdmanager create avd -n DriveMD_Phone -k "$IMAGE" -d pixel_9
sed -i '' 's/^hw.keyboard=.*/hw.keyboard=yes/' ~/.android/avd/DriveMD_Phone.avd/config.ini
emulator -avd DriveMD_Phone -no-snapshot -no-boot-anim &
adb -s emulator-5554 wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
```

The tablet is the same with `pixel_tablet`; booted second, it is `emulator-5556` (`adb devices` lists them). `avdmanager` writes `hw.keyboard=no`, which the `sed` line turns on: the Mac's keyboard then reaches the device, for D6 and K18, and Gboard runs in its mode for a device with a physical keyboard (see Typing, under Tools). The emulator can crash (exit code 139), as it did once on each device during the first run: boot it again with the same command, and its data stays. Give the status bar a fixed time and battery, so that screenshots compare, and send these again if the status bar ignores them right after the boot:

```sh
adb -s <serial> shell settings put global sysui_demo_allowed 1
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command enter
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb -s <serial> shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
```

Keep each device awake from its boot to the end of the run: asleep, it can unload the page or the installed app that a check waits on, such as I1 during a deploy. Android keeps the screen on only while the device thinks it is plugged in, which `dumpsys power` confirms with `mStayOn=true`; the demo mode above still shows the battery unplugged.

```sh
adb -s <serial> shell settings put system screen_off_timeout 2147483647
adb -s <serial> shell svc power stayon true
adb -s <serial> shell dumpsys battery set ac 1
```

The phone must show its camera's cutout in screenshots: when it shows none, turn on Android's own (`adb -s <serial> shell cmd overlay enable com.android.internal.display.cutout.emulation.hole`).

On a new device, Chrome's first run offers to sign in: tap **Stay signed out**, then **No thanks** to notifications. Then turn off ⋮ ▸ Settings ▸ Google services ▸ **Allow Chrome sign-in**: otherwise Google's sign-in, in the app or on drive.google.com, starts Android's add-account flow instead of staying in the page. A couple of minutes after the first boot, Google Play services updates itself, and its restart closes Chrome and Gboard: open the address again. When the image's Chrome is old, its menu starts with **Update Chrome**, which shifts the items under it and opens the Play Store: leave it.

### Install

Once per Mac, besides Node.js 24, pnpm, uv and mobile-mcp, as [`apple-device-checks.md`](apple-device-checks.md#install) says:

- The Android SDK in `~/Library/Android/sdk`, where mobile-mcp looks for `adb` unless `ANDROID_HOME` says otherwise, with its command-line tools in `cmdline-tools/latest`: from Android Studio's **Settings ▸ Languages & Frameworks ▸ Android SDK ▸ SDK Tools**, **Android SDK Command-line Tools (latest)**, or without Android Studio, the archive that Google's repository (`https://dl.google.com/android/repository/repository2-3.xml`) lists for `cmdline-tools;latest` and `macosx`, checked against its SHA-1 there and unzipped. Then install the emulator, `adb` and the image with the Android CLI, which replaces `sdkmanager`: `android sdk install emulator platform-tools "$IMAGE"`. Its `android` command is a launcher that fetches the CLI's newest version into `~/.android/cli`, which no file pins. Leave the Android tools' usage statistics off (`"hasOptedIn":false` in `~/.android/analytics.settings`).
- `avdmanager`, which the devices still need since `android emulator create` takes no device type, image or name, runs on Java 17 or newer: when `java -version` says older, use Android Studio's, `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Put `~/Library/Android/sdk/platform-tools`, `emulator` and `cmdline-tools/latest/bin` on the `PATH`.

Before the first check, the agent checks these with `adb version`, `emulator -version`, `android sdk list`, `node -v`, `pnpm -v`, `uv --version` and whether the `mobile` tools are available, and tells the developer what is missing. `mobile_list_available_devices` also lists a phone plugged into the Mac: use only the emulators, which it names by their AVD name, `DriveMD_Phone`, where `adb` takes their serial, `emulator-5554`.

### Tools

- **mobile-mcp** works as on iOS (see [Tools](apple-device-checks.md#tools)), through `adb`, and `mobile_press_button` also presses `BACK`. `mobile_save_screenshot` writes only under the working directory or the temporary one: save the report's screenshots with `adb -s <serial> exec-out screencap -p > <path>` instead.
- `adb` does the rest: the theme (`shell cmd uimode night yes|no`), the orientation (`shell settings put system accelerometer_rotation 0`, then `shell settings put system user_rotation 0|1|2|3`, a quarter turn each from the device's natural orientation, which is upright on the phone and sideways on the tablet: the tablet stands upright at 1 and 3; `mobile_set_orientation` knows only 0 and 1), the navigation (`shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural`, or `threebutton`), and Back (`shell input keyevent KEYCODE_BACK`). The launcher turns the tablet back sideways and sets `accelerometer_rotation` to 1 again: set the rotation again after each visit to the launcher, and after switching the navigation. Switching the navigation also reloads Chrome's tab.
- **Continue.** After a reload, a launch of the installed app or a share to it, the app may ask **Continue**: tap it, as long as no Google page then asks for anything, which the developer answers.
- **The emulator's window** has its own side bar: Back, Home, Overview, Rotate, and **⋯** for the extended controls.
- **Swipes.** A swipe down from the page's top sets off Chrome's pull-to-refresh, which reloads the page: start swipes lower.
- **The clipboard.** The emulator copies the Mac's clipboard into the device (**⋯ ▸ Settings ▸ General ▸ Enable clipboard sharing**): a paste can bring in whatever the Mac holds, such as a sign-in code. Turn that off, or set the device's clipboard with `mobile_clipboard` right before each paste, and check what was pasted before saving.
- **Typing and the on-screen keyboard.** With `hw.keyboard=yes`, Gboard 18 shows only its floating ≡ button while a field has the focus, whatever `show_ime_with_hard_keyboard` says. **Alt+K** (`adb -s <serial> shell input keycombination KEYCODE_ALT_LEFT KEYCODE_K`), or ≡ ▸ **Show on-screen keyboard**, brings up the full keyboard, which then stays up: neither Alt+K again, `show_ime_with_hard_keyboard` 0 nor Gboard's own setting brought the ≡ back. So D6 runs before the device's first Alt+K (see Order), and the rest with the full keyboard; take a screenshot to see which shows. Gboard's mode for a device with a physical keyboard may insert text differently from a phone without one: say so where a typing check fails. `mobile_type_keys` types through `adb shell input text`, ASCII only, as a hardware keyboard does: Gboard never sees the keys, so neither its autocorrect, capitals and double-space period nor its composition run, and J and K need Gboard's own keys, tapped where a screenshot shows them. `adb shell input text` can also lose a long text's first letters, or let an Enter sent after it overtake its end: check the field before Enter. A long press selects a word, as on a phone.
- **Ctrl.** `adb shell input keycombination` with Ctrl, such as Ctrl+End, can leave Ctrl latched in Gboard, whose delete key then deletes whole words and whose number hints vanish: send `adb -s <serial> shell input keyevent KEYCODE_CTRL_LEFT` after it.
- **Measuring.** Screenshots are in pixels: 2.625 per dp on the phone and 2 on the tablet (`adb -s <serial> shell wm density`, divided by 160). Measure gaps and overlaps on them with a short script (`uv run --with pillow python …`).

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

On each device, D6 comes first, in Chrome, before Gboard's full keyboard has ever come up (see Typing, under Tools): on the phone, before C5, whose D1 to D3 bring the full keyboard up. The first time the editor opens on a device, check K1's default, **Edit** opening Visual, before section D picks Source, which the device then remembers. Run every check in the light theme, unless it says otherwise: E3, section F, H2 and K17 also run the dark one, after which the device goes back to light (`adb -s <serial> shell cmd uimode night no`).

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
- **D6. Hardware keyboard.** First, before Gboard's full keyboard has come up on the device: tap the text. Only Gboard's floating ≡ shows, and the toolbar sits at the screen's bottom, over the gesture bar, one row tall. Then Alt+K brings up the full keyboard for the rest. In the installed app, and wherever the full keyboard has come up before, it is BLOCKED.
- **D8. Back hides the keyboard.** With the keyboard up, press Back once: the keyboard goes, the note stays, and the toolbar moves to the screen's bottom, over the gesture bar, or in Samsung Internet onto its bottom bar, as the spec says. Tap the text: the keyboard and the toolbar come back together.
- **D9. Samsung keyboard.** BLOCKED: the emulator has no Samsung keyboard, which comes only on Samsung's phones.

Then take back the edits with Undo, and pick Visual again, before leaving the editor.

### E. The installed app

- **E1. Install.** In Chrome, on a note's page, tap ⋮ ▸ **Add to home screen** ▸ **Install** (or **Install app**). The dialog offers the name **DriveMD** and DriveMD's mark, not a picture of the page. Chrome makes the app through the Play Store: while the Play Store has no account, Chrome makes a shortcut instead, with Chrome's badge on the icon. Then ask the developer to sign in to the Play Store, which adds the test account to Android; remove the shortcut and install again. Once installed, the launcher shows the mark cut to its own shape, a circle on a Pixel, with the whole mark inside. If the developer chooses not to sign in, record it, run E with the shortcut, and mark L BLOCKED.
- **E2. Launch.** The icon opens the app in a window of its own, without Chrome's bars, on Home rather than the note. The launch screen before the page is light, the manifest's background, with the mark. Each launch may ask **Continue** (see Tools). When the launcher has moved the icon, launch the app with `adb -s <serial> shell monkey -p <package> -c android.intent.category.LAUNCHER 1`, its package from `adb -s <serial> shell pm list packages | grep webapk`.
- **E3. Status bar.** The status bar and the gesture bar's band take the page's background, in the light and the dark theme.
- **E4. Its own app.** Overview lists DriveMD as an app of its own, with its name and its mark, apart from Chrome; Settings ▸ Apps lists it too.
- **E5. No banner.** Home shows no Add to Home Screen banner.
- Then run sections C and D again in the app, and on the phone M, K3, K5, K9 and K10.

### F. The mockups

As [section F](apple-device-checks.md#f-the-mockups) of the iOS checks says, with the phone for the iPhone and the tablet for the iPad; for the conflict, open `device-check-other.md` in two Chrome tabs. `drive-tab-sign-in` and `drive-tab-phone-sign-in` show before sign-in, in a tab that Drive opened with an account: type `/open?state=` in a Chrome tab's address bar, followed by the URL-encoded `{"ids":["<id>"],"action":"open","userId":"<digits>"}`, with a test note's ID and made-up digits, and the tab signs in afresh, with the account the device remembers left alone. An address that an intent or a link opens goes to the installed app instead, even with its links turned off.

### G. A tab opened from Drive

As [section G](apple-device-checks.md#g-a-tab-opened-from-drive) of the iOS checks says, in Chrome. Drive in Chrome on a phone may offer its app first: tap to stay in the browser.

- **G1.** Drive's mobile site has no **Open with**: switch Chrome to ⋮ ▸ **Desktop site**, where a long press on the file offers it. Drive's **Open with ▸ DriveMD** opens production, the only DriveMD that Drive knows: close that tab untouched, and open the address that G1 builds when Drive does not offer DriveMD, on staging.
- **G2.** Run it in an Incognito tab, from ⋮ ▸ **New Incognito tab**; on the tablet, Ctrl+Shift+N opens a second window instead, side by side, which ⋮ ▸ **Manage windows** closes. Chrome keeps Incognito out of screenshots: read the page from its elements.
- **G4.** The new tab is one of Chrome's.

### H. Home and themes

As [section H](apple-device-checks.md#h-home-and-themes) of the iOS checks says, with `adb -s <serial> shell cmd uimode night yes` for the dark appearance.

### I. A new version (only if staging deploys during the run)

As [section I](apple-device-checks.md#i-a-new-version-only-if-staging-deploys-during-the-run) of the iOS checks says, with the installed app sent to the background with Home.

### J. Typed text, as information

- **J1.** In the editor, tap on Gboard's keys: `"quoted" -- it's` and a new line starting with `next`. After the apostrophe, Gboard goes back to its letters by itself. The text stays as typed: straight quotes, two hyphens, a straight apostrophe, no corrected word, and no capital on `next`.
- **J2.** Type a word, then two spaces with quick taps on the space bar. Gboard turns them into a period and a space, which the editor takes back: the source holds the word and two spaces.

### K. Visual, Source and Viewing (v2, stage 1)

Run K1 to K18 of [section K](apple-device-checks.md#k-visual-source-and-viewing-v2-stage-1) of the iOS checks on `device-check-visual.md`, with the phone for the iPhone, the tablet for the iPad and Chrome for Safari, typing on Gboard's keys, with the changes and the checks below. Gboard sends what it types through composition: it holds the word being typed as marked text, which it may rewrite as it goes, where iOS does that only for Japanese or Chinese. Visual changes a line's text as the cursor enters it, so these checks watch for letters or symbols lost, doubled or moved. The emulator runs Gboard itself, so it stands for a phone here, as it did for milestone 8: the report says which checks a real phone must repeat, if any, and why.

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
