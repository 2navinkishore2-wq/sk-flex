# SK Flex Billing

A fast, professional billing app for a **Flex / Sign Board / Printing shop** — built once, runs on **Web, Windows (EXE) and Android (APK)** from a single codebase with one shared cloud database.

**Open → Select Customer → Enter Size → Bill → Save → Print.**

---

## 1. What's inside

| Feature | Where |
|---|---|
| Dashboard (today's sales/bills, customers, outstanding) | `src/pages/Dashboard.tsx` |
| Billing with auto calculation (W×H×Rate) | `src/pages/Billing.tsx` + `src/lib/billing.ts` |
| Customers (add/edit/search/delete, invoices, ledger) | `src/pages/Customers.tsx`, `CustomerDetail.tsx` |
| Invoice history + **date-wise grouping by Bill Date** | `src/pages/Invoices.tsx` |
| **Bill Date** (editable, saved with the bill) + **Cash Payment section with per-payment dates** | `src/pages/Billing.tsx` |
| Customer ledger + payments | `src/services/ledger.ts`, `payments.ts` |
| Product rates + **Frame Rate Table** | `src/pages/Rates.tsx`, `src/services/settings.ts` |
| Invoice settings + backup/export | `src/pages/Settings.tsx`, `src/services/backup.ts` |
| Invoice PDF / JPG / Print (A4) | `src/services/export.ts`, `src/components/InvoiceDocument.tsx` |
| Cloud sync + offline (Firestore) | `src/services/firestoreService.ts` |
| Demo/offline local backend | `src/services/localService.ts` |
| Google Sign-In | `src/services/firestoreService.ts` |

### Tech stack (all free / open source)

- **Frontend:** React 18 + TypeScript + Vite (one shared codebase)
- **Cloud:** Firebase — **Firestore** (database + offline cache + realtime sync) and **Firebase Auth (Google)**
- **Android:** Capacitor
- **Windows:** Electron
- **PDF:** jsPDF · **JPG:** html2canvas-pro · **Money math:** decimal.js
- **PWA:** vite-plugin-pwa (installable web app, offline shell)

### Why Firebase (over Supabase/self-hosted)

Firestore is the only major free backend with **built-in offline-first sync**: it caches every read locally (IndexedDB) and replays writes when connectivity returns — exactly what a shop needs when the internet drops mid-billing. Supabase's free tier is generous but offline sync must be built manually; a self-hosted CouchDB/PocketBase adds server maintenance. Firebase also bundles **free Google Sign-In** and a free tier that is plenty for a single shop.

> The data layer is behind one interface (`src/services/data.ts`). If you ever want to switch backends, you implement the same methods and change one factory (`src/services/index.ts`) — all pages, billing, ledger and exports stay untouched.

---

## 2. Zero-cost plan (₹0/month)

| Service | Free tier (Spark plan) | Enough for |
|---|---|---|
| Firebase Auth (Google) | Free, unlimited | ✅ |
| Firestore | 1 GiB storage · 50K reads/day · 20K writes/day · 1K deletes/day | ~30 bills/day with thousands of stored invoices |
| Hosting | Optional; can host the PWA on Firebase Hosting (free) or any static host | ✅ |
| PDF/JPG generation | Runs **on-device** (jsPDF/html2canvas) — no paid API | ✅ |

Limitations to know:
- The **Spark plan never expires** for small usage, but if you one day exceed 50K document reads/day (e.g. >10,000 invoices and many devices opening the app repeatedly), upgrade to Blaze (pay-as-you-go, still cents/month) or reduce the loaded history.
- Firestore multi-device edits use **last-write-wins per field**; see *Sync safety* below.
- **Google Sign-In on Android** uses the **native Credential Manager** (`@capgo/capacitor-social-login`) and exchanges the ID token with the existing Firebase JS SDK — same UID as Web/Windows. You MUST register the Android app and SHA-1 in Google Cloud Console for native sign-in. Without these, the app falls back to the JS SDK redirect flow (less reliable in the WebView).

---

## 3. Project structure

```
├── src/
│   ├── lib/          # pure logic: types, money, billing math, formatting, constants, platform
│   ├── services/     # data service interface, Firestore + local backends, business services, export, backup
│   ├── store/        # global state (auth, live data, sync status)
│   ├── components/   # UI kit, layout, invoice document
│   └── pages/        # Dashboard, Billing, Invoices, Customers, Ledger, Rates, Settings, Login
├── electron/         # Windows EXE main process + preload
├── android/          # Capacitor Android project (generated)
├── firebase/         # Firestore security rules + indexes
├── scripts/          # icon generator (pure JS, no native deps)
└── public/           # logo, PWA icons
```

---

## 4. Quick start (no cloud config — Demo Mode)

```bash
npm install
npm run dev          # opens http://localhost:5173
```

On the login screen choose **"Continue without account (Demo)"**. Everything (customers, billing, ledger, PDF/JPG/print, backup) works locally in the browser using localStorage. This is also the offline path — Demo mode is the same code, just without cloud sync.

Run the automated test suite (includes the 10×10 = ₹750 check):

```bash
npm test
```

---

## 5. Setup Firebase (cloud sync + Google Sign-In)

1. Create a free project at <https://console.firebase.google.com>.
2. **Add a Web App** → copy the config values.
3. **Authentication → Sign-in method → enable Google**.
4. **Firestore Database → Create database** (choose *Production mode*).
5. Deploy the security rules (they isolate every user's data):

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes   # from the project root
   ```

   (Or paste the contents of `firebase/firestore.rules` manually in Console → Firestore → Rules.)

6. Copy `.env.example` to `.env` and fill the six `VITE_FIREBASE_*` values:

```
# Required — from the Firebase console web-app snippet (see §5 step 2)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Optional — defaults are fine
VITE_DATA_MODE=auto           # auto | cloud | local
```

**How the app decides cloud vs demo (`VITE_DATA_MODE`):**

| Value | Behavior |
|---|---|
| `auto` (default) | **Cloud** if all six `VITE_FIREBASE_*` values are present, otherwise **Demo mode** (localStorage). The login screen shows *Sign in with Google* only when cloud is active. |
| `cloud` | Require Firebase config — shows the setup screen if any value is missing. |
| `local` | Force Demo mode even if Firebase is configured (data stays on the device). |

**Auth flow is automatic — do not set `VITE_AUTH_METHOD`.** It is not read by the code: Web and Windows use the Google **popup** flow, and Android automatically uses the **redirect** flow (the app detects the native WebView via `isNative()`). No environment variable is needed for this.

> The six values are **public by design** (they identify your project). Security comes from the Firestore rules + Google sign-in, never from hiding keys. No secrets go into the APK/EXE.

### Local cloud testing (Firebase emulator)

Before touching your real project you can verify cloud behavior — sign-in, rules isolation, realtime sync, offline queue — against the **Firebase emulator**, which enforces the real `firebase/firestore.rules`.

**Requirement: Java 11+ (JDK 17 recommended).** The emulator is a Java process. On Windows, install the **Temurin JDK 17** from <https://adoptium.net> (64-bit `.msi`), then verify in a new terminal:

```bash
java -version        # must print a version >= 11, e.g. openjdk version "17.0.x"
```

(Android Studio also bundles a JDK — set `JAVA_HOME` to `C:\Program Files\Android\Android Studio\jbr` — but a standalone JDK is simpler.) The first emulator run downloads ~150 MB of emulator binaries automatically.

```bash
npm run cloud:verify     # starts emulators, runs the 8 checks (auth, isolation, sync,
                         # offline billing, reconnect, duplicates, numbering, persistence), stops
npm run cloud:emulators  # keeps emulators running; stop with Ctrl+C
```

To develop against the local emulator instead of production, set in `.env`:

```
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1:8080
```

**Environment separation is enforced in code:** the emulator is wired only when `import.meta.env.DEV` is true (Vite replaces this with the literal `false` in production builds), so a production build — Web, APK or EXE — can **never** connect to an emulator, even if the variable is set. Keep the six real `VITE_FIREBASE_*` values out of any `.env` used for emulator testing, and vice versa.

**CI (GitHub Actions):** the repo includes `.github/workflows/ci.yml` — free for public repos. On every push/PR it runs `npm test` + `npm run build`, and a second job runs `npm run cloud:verify` (installs JDK 17 on the runner) so the sync/isolation checks are enforced automatically.

---

## 6. Build the Web version (PWA)

```bash
npm run build        # type-check + production build into dist/
npm run preview      # serve locally to verify
```

Deploy `dist/` to Firebase Hosting, Netlify, Vercel, GitHub Pages… anything static. The web app is installable (Add to Home Screen) and keeps working offline once opened.

**Deploy to Firebase Hosting (also deploys the Firestore rules + indexes):**

```bash
firebase login                 # one-time, opens a browser
npm run deploy:web             # type-check + build + deploy hosting, rules, indexes
```

The root `firebase.json` configures Hosting (public `dist/`, SPA rewrite, immutable cache headers for hashed assets, `no-cache` for the service worker) and points the Firestore rules/indexes at `firebase/firestore.rules` and `firebase/firestore.indexes.json`. After deploying, add your Hosting domain to **Authentication → Settings → Authorized domains**.

---

## 7. Build the Android APK

Requirements: Android Studio (or just the Android SDK + JDK 17+).

### Quick start (debug APK)

1. **Register the Android app in Firebase Console** (see manual steps in §9) — without this the native sign-in WILL fail with "Google Sign-In failed: 10: Developer console is not set up correctly". The app then falls back to the JS SDK redirect flow (less reliable in the WebView).
2. **Set `VITE_GOOGLE_WEB_CLIENT_ID`** in `.env` — this is the **Web OAuth client ID** (client_type 3) from your Firebase project, found in Firebase Console → Project settings → General → Web apps → Web client ID. Without this, Android falls back to the redirect flow.
3. **Build the debug APK:**
   ```bash
   npm run android:apk       # Windows (gradlew.bat)
   npm run android:apk:sh    # macOS/Linux
   ```
   The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk` (≈10 MB, signed with the auto-generated debug key).

### Fingerprints (for the Firebase Android app)

Register these in Firebase Console → Project settings → Your apps → Android app → Add fingerprint:

```bash
npm run android:shas
```

This outputs:
- **Debug SHA-1 / SHA-256** (from `~/.android/debug.keystore`) — register both.
- **Release SHA-1 / SHA-256** — only shown if `android/keystore.properties` exists.

Both debug fingerprints are required for Google Credential Manager to accept sign-in attempts.

### Native sign-in architecture

The app never calls `google-services.json` or the native Firebase SDK. Instead:
1. `@capgo/capacitor-social-login` uses **Credential Manager** (AndroidX Credentials) to sign in with the device Google account.
2. The plugin returns a Google **ID token**.
3. The app calls `GoogleAuthProvider.credential(idToken)` + `signInWithCredential(auth, cred)` on the **existing Firebase JS SDK**.
4. Firebase returns the **same UID** that the web popup produces for the same Google account → one data scope: `users/{uid}/...`.

This keeps a single Firebase Auth initialization and the existing `onAuthStateChanged` wiring unchanged. On the Web/Electron popup path everything works as before.

### Signed release APK / AAB

1. Create a release keystore once (JDK `keytool`):
   ```bash
   keytool -genkeypair -v -keystore android/release.keystore -alias skflex \
     -keyalg RSA -keysize 2048 -validity 10000 -storepass CHANGE_ME -keypass CHANGE_ME
   ```
2. Copy `android/keystore.properties.example` → `android/keystore.properties` and fill in the values. Both the file and the keystore are **git-ignored — never commit them**. Without this file the release build is unsigned.
3. Add the **release SHA-1 / SHA-256** to the Android app in Firebase Console (run `npm run android:shas` after setting up keystore.properties).
4. Build the release **AAB** (for Play Store) or APK:
   ```bash
   npm run android:release      # Windows — AAB in android/app/build/outputs/bundle/release/
   npm run android:release:sh   # macOS/Linux
   ```
   For a plain signed APK instead, run `gradlew.bat assembleRelease` inside `android/` (output in `android/app/build/outputs/apk/release/`).

To update the app after code changes: `npm run android:sync` then rebuild.

> **Icons:** placeholder icons are generated by `node scripts/generate-icons.mjs`. Drop your real SK logo into `public/logo.png` (256px+), re-run the script for app icons, and replace the in-app mark at `public/logo.svg`.

---

## 8. Build the Windows EXE

```bash
npm run electron:build       # builds web app + packages the Windows installer
```

Output in `release/` (an NSIS installer + portable exe). The EXE opens its own window, supports printing (Ctrl+P), PDF/JPG download, cloud sync and offline billing. First run may show a SmartScreen warning because the app is unsigned — click *More info → Run anyway*, or sign it later with a code-signing certificate.

---

## 9. How it all works

### Google Sign-In
The app picks the flow automatically — **no configuration needed**:
- **Web / Windows:** a Google popup opens, account chosen, Firebase issues a session (persisted, so you stay signed in).
- **Android:** the app detects the native WebView (`isNative()`) and uses the **redirect** flow — the WebView redirects through Google and returns to the app, where `getRedirectResult` resolves the session.
- **Every auth path is one source of truth:** the popup, the Android redirect return, and **session restore after a page reload** all go through `onAuthStateChanged`, which sets the user scope (`users/{uid}/…`) and ensures the user's profile doc exists exactly once. `AppContext` keeps the app on the **Loading** screen until Firebase resolves the session, so signed-in users never see a login flash.
- Each user's data lives under `users/{uid}/…` and the Firestore rules reject any access where `request.auth.uid != userId`, so **User A can never see User B's data**.

### Web ↔ Windows ↔ Android sync
All three run the same app code and talk to the same Firestore project. Firestore keeps every device's local cache in sync in real time (and on app open), so a bill made on the phone appears on the PC and in the browser automatically.

### Offline billing
Firestore's offline persistence stores all data on the device (IndexedDB / WebView storage). When the internet drops you keep billing normally; every change is queued locally and pushed automatically when connectivity returns. A status pill always shows **Synced / Syncing… / Offline / Sync error**, and a banner appears when offline.

### Sync safety (no silent data loss)
- Every record has a unique id + `createdAt`/`updatedAt`.
- Invoices snapshot their own items, rates and totals — **changing today's rate never touches old invoices**.
- Invoice numbers come from an **atomic Firestore transaction** (a counter document), so two devices can't be handed the same number. If two devices somehow create a bill offline at the same time, a startup reconciliation pass renumbers the newer duplicate and flags it.
- Multi-device edits to the same record use **last-write-wins per field** (documented strategy). Payments and ledger edits append entries rather than overwriting history.

### Backup
The cloud database is the primary backup. `Settings → Export Backup` downloads a JSON of everything (customers, invoices, payments, ledger, frame rates, settings); `Restore Backup` re-imports it. Invoices and customers also export to CSV.

### Production Google Sign-In checklist

**Automatic (already done in code — verified by tests/emulator):**

- [x] Correct package/application ID — `com.skflexbilling.app` in `capacitor.config.ts` + `android/app/build.gradle`
- [x] Google Sign-In provider flow (popup on Web/Windows; **native Credential Manager** on Android with JS SDK `signInWithCredential` fallback)
- [x] Session restore after reload (no login flash) + profile doc ensured once per user
- [x] Firestore rules isolate `users/{uid}/…` (no public access, no cross-user reads)
- [x] Sign-out clears the session scope; sign-in again restores the same data (no duplication)
- [x] Offline billing + reconnect sync unchanged (verified by `npm run cloud:verify`)

**Manual — Firebase Console actions only you can do:**

- [ ] Create the Firebase project + **Web app**, enable **Google** under Authentication → Sign-in method
- [ ] Fill the six `VITE_FIREBASE_*` values in `.env` (from the web-app snippet)
- [ ] Deploy rules/indexes: `firebase login && npm run deploy:web`
- [ ] Add your Hosting domain (and `localhost` for testing) to **Authentication → Settings → Authorized domains**
- [ ] **Android — register the app + fingerprints:**
      1. Firebase Console → Project settings → Your apps → Add app → **Android**
      2. Package name: `com.skflexbilling.app`
      3. Run `npm run android:shas` on your machine, copy both **SHA-1** and **SHA-256** from the Debug line
      4. Paste them into the form and click Register app
      5. **Do NOT download** `google-services.json` (skip that step) — this app does not use it
      6. After registering, go to **Google Cloud Console → Credentials** and confirm there is an **Android OAuth 2.0 client** for `com.skflexbilling.app`. You do NOT need to copy any values from it into the project.
      7. Add `VITE_GOOGLE_WEB_CLIENT_ID` to `.env` (see `.env.example`): find it as the **Web client ID** in the same Firebase Console → Project Settings → General → Web apps → Web client ID (or in Google Cloud Console Credentials, client_type 3).
      8. If you later create a release keystore, add its SHA-1/SHA-256 to the same Android app too.
- [ ] Test debug APK sign-in and release APK sign-in on a real device with the same Google account as the PC
- [ ] Two-device test: create data on PC → appears on phone; create on phone → appears on PC; sign out/in keeps the data

---

## 10. Frame Rate Table (where to enter rates)

The real **SK Photo Frame price list** (19 sizes from 8×6 to 36×48 in, each with BEADING / 1 inc / 1.5 inc / 2 inc prices) is **auto-seeded on first sign-in** — only when the frameRates collection is empty or still has the old flat-row shape, so your edits are never overwritten. Open **Rates → Frame Rate Table** to see one row per size:

| Size | BEADING (₹) | 1 INC (₹) | 1.5 INC (₹) | 2 INC (₹) |
|---|---|---|---|---|
| 8x6 | 70 | 130 | — | — |
| 12x18 | 255 | 350 | 400 | 450 |
| 36x48 | 3050 | 3850 | 4300 | 4800 |

Every cell is an inline **number input** — edit a size or a price, leave a price **empty** when that thickness isn't offered (stored as `null`, never `0`), **Add Size** for a new row, and press **Save Changes** (size must be non-empty, `WxH` format, no duplicate sizes). Deleting uses a confirm dialog and applies on save.

The **Frame calculator in Billing reads the same table**: pick a photo size + thickness and the price comes straight from the saved row — change a rate in Settings and the calculator uses it immediately (it's a live, synced collection). Old invoices keep the rate they were billed at. Frame prices are stored in Firestore (`users/{uid}/frameRates`) as `{ size, beading, oneInch, onePointFiveInch, twoInch, active }` — one source of truth, never hard-coded.

**Product rates** (Flex ₹7.50, Vinyl/Star/Sunpack ₹25) are edited on the same page under *Product Rates*.

---

## 11. Configuration checklist

| Item | Where | Required for |
|---|---|---|
| `.env` with 7 Firebase/Google values | project root | Google sign-in + cloud sync |
| Google sign-in enabled in Firebase Console | Authentication → Sign-in method | auth |
| **Android app registered + SHA-1/SHA-256** | Firebase Console → Project settings | native Android sign-in (run `npm run android:shas`) |
| `VITE_GOOGLE_WEB_CLIENT_ID` copied into `.env` | project root | native Android sign-in (Web client ID from Firebase) |
| Firestore rules deployed | `firebase/firestore.rules` | security/isolation |
| (optional) `android/keystore.properties` | `android/` (git-ignored) | signed release APK/AAB |
| (optional) `android/app/google-services.json` | `android/app/` (git-ignored) | only needed if you add FCM later |
| `VITE_DATA_MODE=auto` (optional) | `.env` | force cloud/demo behavior |
| JDK 17 (Temurin) | dev machine / CI | `npm run cloud:verify` (emulator) |
| Your logo | `public/logo.svg` + `public/logo.png`, re-run `npm run icons` | branding |
| Frame rates | Rates page in the app | frame billing |

---

## 12. Troubleshooting

- **`npm run cloud:verify` fails with "Could not spawn `java -version`"** — Java is installed but not on PATH. Open a NEW terminal after installing, or run with your JDK on PATH: `set PATH=%JAVA_HOME%\bin;%PATH%` (cmd) / `export PATH="$JAVA_HOME/bin:$PATH"` (bash). If you only have Android Studio's bundled JDK, that works too — it's at `C:\Program Files\Android\Android Studio\jbr`.
- **"Cloud configuration required"** — `.env` is missing/incomplete; fill the 6 values or use Demo mode.
- **Google sign-in fails on Android with "Developer console is not set up correctly"** — this is a *native* Credential Manager error. The app falls back to the redirect flow, which may also fail in the WebView. Fix: register your Android app (`com.skflexbilling.app`) in Firebase Console with the debug SHA-1 fingerprint from `npm run android:shas`, then add `VITE_GOOGLE_WEB_CLIENT_ID` to `.env`. See section 7 above. After making these changes, rebuild the APK and reinstall.
- **Google sign-in still fails after registering SHA-1** — Google Cloud changes can take a few hours to propagate. Also make sure the OAuth consent screen is in **Testing** mode and your Google account is added as a test user. Check Logcat for the exact error: `adb logcat | grep GoogleProvider`.
- **Google sign-in fails on Windows** — this is the web popup flow, which needs the Hosting domain on **Authentication → Settings → Authorized domains** in Firebase Console (add `localhost` for local dev).
- **Release APK can't sign in while debug APK works** — the WebView OAuth flow doesn't depend on the signing key, so check the `.env` values actually baked into the release build, the authorized domain, and that the release build isn't an old cached build (`npm run android:sync` first).
- **`npm run android:apk` says "gradlew.bat is not recognized"** — some Windows setups set `NoDefaultCurrentDirectoryInExePath=1`, so cmd won't run a bare `gradlew.bat` from the current folder. The scripts now use `.\gradlew.bat` (works either way).
- **Gradle build fails with "SDK location not found"** — create `android/local.properties` with `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` (or set `ANDROID_HOME`). The file is git-ignored. If the Gradle wrapper itself times out downloading, `android/gradle/wrapper/gradle-wrapper.properties` uses a 60s `networkTimeout`; if Java still can't download, fetch `gradle-8.2.1-all.zip` with a browser/curl into `~/.gradle/wrapper/dists/gradle-8.2.1-all/` and re-run.
- **PDF/JPG missing the logo** — the app rasterizes `public/logo.svg` automatically; make sure the file exists.
- **Two devices created bills offline and got the same number** — the app renumbers the newer one on next sync (visible in invoice history).
- **Firestore read limits** — the app loads all records for instant search/aggregation. A normal shop (≤ ~100 bills/day) stays far below 50K reads/day. If you grow large, ask about enabling a date-scoped load.

---

## 13. Development scripts

```bash
npm run dev              # dev server
npm test                 # unit + workflow + cloud-config tests (28 tests incl. 10×10=₹750)
npm run build            # type-check + production web build (PWA)
npm run preview          # serve the production build
npm run deploy:web       # build + deploy web to Firebase Hosting + Firestore rules/indexes
npm run cloud:verify     # 8 emulator checks: auth, isolation, 2-device sync, offline billing,
                         # reconnect, duplicates, invoice numbers, persistence (needs JDK 17)
npm run cloud:emulators  # keep the Firebase emulators running for local development
npm run icons            # regenerate placeholder PNG icons
npm run electron:dev     # run the Electron app against the dev server
npm run electron:build   # Windows EXE installer
npm run android:sync     # build web + copy into the Android project
npm run android:apk      # build the debug APK (Windows)
npm run android:release  # signed release AAB (needs android/keystore.properties)
npm run android:shas     # print debug + release keystore SHA-1/SHA-256 fingerprints
```
