# SK Flex Android Build – Root Cause & Fixes

## Root cause (explains #2–#7 in your list)

`android-capacitor/android/app/src/main/assets` was **completely empty** in the
uploaded project. Gradle happily compiles and packages an APK even with an
empty assets folder — it never fails the build — but the resulting APK
contained no `index.html`, no `css/`, `js/`, `fonts/`, `assets/`, and no
`capacitor.config.json`.

I confirmed this by inspecting your existing `app-debug.apk`:
```
assets/native-bridge.js     <- only Capacitor's internal bridge script
```
No `assets/public/*` and no `assets/capacitor.config.json` were present.

That single missing step is why:
- The WebView has nothing to load → **error immediately after launch**.
- **Main UI never loads** (there's no `index.html` to show).
- **Splash never appears** — the SplashScreen plugin has no config
  (`capacitor.config.json` missing) and the activity errors out before the
  splash can be dismissed cleanly.
- **"Resources missing"** — literally true, none were copied into the APK.

### The fix
This is a **missing build step**, not a code bug: `npx cap sync android`
(or at minimum `npx cap copy android`) must run **before** `gradlew
assembleDebug`. This copies `www/` → `android/app/src/main/assets/public`
and writes `capacitor.config.json` / `capacitor.plugins.json` into
`android/app/src/main/assets`.

I ran it for you and included the generated output in this package under
`android/app/src/main/assets/`. Going forward, add it to your build
pipeline, e.g. in `android-capacitor/package.json`:

```json
"scripts": {
  "build:apk": "npx cap sync android && cd android && gradlew.bat assembleDebug"
}
```

or as a Gradle `preBuild` dependency task, so it can never be forgotten
again.

No Capacitor config, Manifest, `MainActivity.java`, `build.gradle`, or
plugin-registration changes were needed — those were all already correct:
- `capacitor.config.json` (webDir: `www`, splash/status-bar/filesystem
  plugin config) ✅
- `AndroidManifest.xml` (activity, FileProvider, permissions) ✅
- `MainActivity.java` (plugin registration order — `registerPlugin()`
  before `super.onCreate()` — is the documented Capacitor pattern) ✅
- `settings.gradle` / `variables.gradle` / `app/build.gradle`
  (core-splashscreen dependency, plugin module includes) ✅
- No Electron-only code (`require`, `ipcRenderer`, `window.require`, etc.)
  was found anywhere in `www/js/*` — the web build is already clean for
  Android. ✅

## Issue #2 — App icon incorrect (separate bug, also fixed)

`mipmap-anydpi-v26/ic_launcher_foreground.png` and all legacy
`mipmap-*/ic_launcher.png` files had the logo art **bled to the full edge**
of the canvas with zero padding. Android's adaptive-icon masks (circle,
squircle, rounded-square, etc. — used by most launchers) only guarantee the
inner ~66% of the 108dp canvas is visible, so your logo's outer red/green
border was being clipped off on real devices, making the icon look broken.

Fixed by regenerating all launcher icons from `www/assets/logo.png` with
proper safe-zone padding:
- `mipmap-anydpi-v26/ic_launcher_foreground.png` — logo scaled to ~62% of
  the canvas, transparent background (background layer already uses
  `@color/ic_launcher_background`).
- `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png` and `..._round.png` —
  regenerated at the correct legacy sizes (48/72/96/144/192px) with the
  logo inset on a white background (round variants were missing entirely
  before and are now included).

## Issue #3 — Splash screen (contributing factor, also fixed)

`drawable/splash_logo.png` was only 120×120 and, like the launcher icon,
had no padding — with `windowSplashScreenAnimatedIcon` this gets masked
into a small circular/square icon frame and the bleeding edges get cut off.
Regenerated at 480×480 with the logo scaled to ~55% and centered on a
transparent background, matching the `Theme.SplashScreen` /
`androidx.core:core-splashscreen` styling already set up correctly in
`values/styles.xml`.

## Files included in this package

```
android/app/src/main/assets/**              (regenerated via `cap sync` — the missing web bundle)
android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_foreground.png
android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png
android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_round.png  (new)
android/app/src/main/res/drawable/splash_logo.png
```

Drop these into your project (overwriting the existing files at the same
paths), then build:

```bash
cd android-capacitor
npx cap sync android      # safe to re-run; keeps assets in sync with www/
cd android
gradlew.bat assembleDebug
```

The APK will now contain the full web app, correct icons, and a working
splash screen. I wasn't able to run the Gradle/Android build itself in this
sandbox (no Android SDK / no network to fetch the Gradle 8.13 distribution
here), so please run the above locally or in CI to produce the final
`app-debug.apk` — no further source changes should be required.

## Cloud backup / sync (Google Sign-In)

The app now ships with Google Drive cloud backup/sync (Backup Now, Sync Now,
Restore from Cloud in Settings → Cloud Backup). On Android this uses
`@capacitor-community/google-sign-in@^6` (added to `package.json` and
`capacitor.config.json`). Before it can work you must set up Google:

1. Create a Google Cloud project, enable **Drive API** and the OAuth
   consent screen, and add the scope
   `https://www.googleapis.com/auth/drive.appdata`.
2. Generate the **Android client ID**: register the app's signing
   certificate SHA-1 fingerprint with package `com.skflex.billing` and
   download `google-services.json` into
   `android/app/google-services.json` (the GoogleAuth plugin reads the
   Android client id automatically from it).
3. Also create a **Web application** OAuth client ID. Put its id in two
   places:
   - `www/cloud-config.json` → `android.webClientId`
   - `android-capacitor/capacitor.config.json` → `plugins.GoogleSignIn.webClientId`
4. After editing `package.json`, run `npm install` and then
   `npx cap sync android` so `capacitor.plugins.json` regenerates and picks
   up the GoogleAuth plugin, then build as above.

The same Google account is shared with the desktop (Electron) app, which
uses its own PKCE OAuth flow configured in `cloud-config.json` at the
project root.

