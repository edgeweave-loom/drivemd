# Setting up the Android Emulator for the device checks

How to prepare a Mac for [`android-device-checks.md`](android-device-checks.md): the emulator's devices, what to install, the tools the agent drives them with, and what to do when one fails. Node.js, pnpm, uv and mobile-mcp come from [`device-setup-apple.md`](device-setup-apple.md#install).

## Devices

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

The tablet is the same with `pixel_tablet`; booted second, it is `emulator-5556` (`adb devices` lists them). `avdmanager` writes `hw.keyboard=no`, which the `sed` line turns on: the Mac's keyboard then reaches the device, for D6 and K18, and Gboard runs in its mode for a device with a physical keyboard (see Typing, under Tools). Give the status bar a fixed time and battery, so that screenshots compare, and send these again if the status bar ignores them right after the boot:

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

On a new device, Chrome's first run offers to sign in: tap **Stay signed out**, then **No thanks** to notifications. Then turn off ⋮ ▸ Settings ▸ Google services ▸ **Allow Chrome sign-in**: otherwise Google's sign-in, in the app or on drive.google.com, starts Android's add-account flow instead of staying in the page. When the image's Chrome is old, its menu starts with **Update Chrome**, which shifts the items under it and opens the Play Store: leave it.

## Install

Once per Mac, besides Node.js 24, pnpm, uv and mobile-mcp, as [`device-setup-apple.md`](device-setup-apple.md#install) says:

- The Android SDK in `~/Library/Android/sdk`, where mobile-mcp looks for `adb` unless `ANDROID_HOME` says otherwise, with its command-line tools in `cmdline-tools/latest`: from Android Studio's **Settings ▸ Languages & Frameworks ▸ Android SDK ▸ SDK Tools**, **Android SDK Command-line Tools (latest)**, or without Android Studio, the archive that Google's repository (`https://dl.google.com/android/repository/repository2-3.xml`) lists for `cmdline-tools;latest` and `macosx`, checked against its SHA-1 there and unzipped. Then install the emulator, `adb` and the image with the Android CLI, which replaces `sdkmanager`: `android sdk install emulator platform-tools "$IMAGE"`. Its `android` command is a launcher that fetches the CLI's newest version into `~/.android/cli`, which no file pins. Leave the Android tools' usage statistics off (`"hasOptedIn":false` in `~/.android/analytics.settings`).
- `avdmanager`, which the devices still need since `android emulator create` takes no device type, image or name, runs on Java 17 or newer: when `java -version` says older, use Android Studio's, `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Put `~/Library/Android/sdk/platform-tools`, `emulator` and `cmdline-tools/latest/bin` on the `PATH`.

Before the first check, the agent checks these with `adb version`, `emulator -version`, `android sdk list`, `node -v`, `pnpm -v`, `uv --version` and whether the `mobile` tools are available, and tells the developer what is missing. `mobile_list_available_devices` also lists a phone plugged into the Mac: use only the emulators, which it names by their AVD name, `DriveMD_Phone`, where `adb` takes their serial, `emulator-5554`.

## Tools

- **mobile-mcp** works as on iOS (see [Tools](device-setup-apple.md#tools)), through `adb`, and `mobile_press_button` also presses `BACK`. `mobile_save_screenshot` writes only under the working directory or the temporary one: save the report's screenshots with `adb -s <serial> exec-out screencap -p > <path>` instead.
- `adb` does the rest: the theme (`shell cmd uimode night yes|no`), the orientation (`shell settings put system accelerometer_rotation 0`, then `shell settings put system user_rotation 0|1|2|3`, a quarter turn each from the device's natural orientation, which is upright on the phone and sideways on the tablet: the tablet stands upright at 1 and 3; `mobile_set_orientation` knows only 0 and 1), the navigation (`shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural`, or `threebutton`), and Back (`shell input keyevent KEYCODE_BACK`). The launcher turns the tablet back sideways and sets `accelerometer_rotation` to 1 again: set the rotation again after each visit to the launcher, and after switching the navigation. Switching the navigation also reloads Chrome's tab.
- **Continue.** After a reload, a launch of the installed app or a share to it, the app may ask **Continue**: tap it, as long as no Google page then asks for anything, which the developer answers.
- **The emulator's window** has its own side bar: Back, Home, Overview, Rotate, and **⋯** for the extended controls.
- **Swipes.** A swipe down from the page's top sets off Chrome's pull-to-refresh, which reloads the page: start swipes lower.
- **The clipboard.** The emulator copies the Mac's clipboard into the device (**⋯ ▸ Settings ▸ General ▸ Enable clipboard sharing**): a paste can bring in whatever the Mac holds, such as a sign-in code. Turn that off, or set the device's clipboard with `mobile_clipboard` right before each paste, and check what was pasted before saving.
- **Typing and the on-screen keyboard.** With `hw.keyboard=yes`, Gboard 18 shows only its floating ≡ button while a field has the focus, whatever `show_ime_with_hard_keyboard` says. **Alt+K** (`adb -s <serial> shell input keycombination KEYCODE_ALT_LEFT KEYCODE_K`), or ≡ ▸ **Show on-screen keyboard**, brings up the full keyboard, which then stays up: neither Alt+K again, `show_ime_with_hard_keyboard` 0 nor Gboard's own setting brought the ≡ back. A paste from the Mac (Cmd+V) brings it up too, so the developer types the sign-ins' address and password key by key until D6 has run; the full keyboard may flash up at a field's first tap, until the first letter typed folds it to the ≡. So D6 runs before the device's first Alt+K (see [Order](android-device-checks.md#order)), and the rest with the full keyboard; take a screenshot to see which shows. Gboard's mode for a device with a physical keyboard may insert text differently from a phone without one: say so where a typing check fails. `mobile_type_keys` types through `adb shell input text`, ASCII only, as a hardware keyboard does: Gboard never sees the keys, so neither its autocorrect, capitals and double-space period nor its composition run, and J and K need Gboard's own keys, tapped where a screenshot shows them. `adb shell input text` can also lose a long text's first letters, or let an Enter sent after it overtake its end: check the field before Enter. A long press selects a word, as on a phone.
- **Ctrl.** `adb shell input keycombination` with Ctrl, such as Ctrl+End, can leave Ctrl latched in Gboard, whose delete key then deletes whole words and whose number hints vanish: send `adb -s <serial> shell input keyevent KEYCODE_CTRL_LEFT` after it.
- **Measuring.** Screenshots are in pixels: 2.625 per dp on the phone and 2 on the tablet (`adb -s <serial> shell wm density`, divided by 160). Measure gaps and overlaps on them with a short script (`uv run --with pillow python …`).

## Troubleshooting

The iOS checks' [Troubleshooting](device-setup-apple.md#troubleshooting) covers mobile-mcp and mobilecli, and these come on top:

| What happens                                                     | What to do                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The emulator exits with code 139                                 | It crashed, as it did once on each device during the first run: boot it again with `emulator -avd <name> -no-snapshot -no-boot-anim &`, not the whole block that creates it, and its data stays. |
| Chrome and Gboard close a couple of minutes after the first boot | Google Play services updated itself, and its restart closed them: open the address again.                                                                                                        |
| The status bar ignores the demo mode right after a boot          | Send the demo mode's commands again (see Devices).                                                                                                                                               |
| A page or the installed app unloads while a check waits          | The device fell asleep: keep it awake (see Devices).                                                                                                                                             |
| Gboard's delete key deletes whole words, and its number hints go | Ctrl is latched after an `adb` key combination: send `adb -s <serial> shell input keyevent KEYCODE_CTRL_LEFT` (see Ctrl, under Tools).                                                           |
| A note opened from the app stays in Chrome                       | Android does not let the app take staging's links: check and re-verify them as [G4](android-device-checks.md#g-a-tab-opened-from-drive) says.                                                    |
