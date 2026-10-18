# Mobile (iOS and Android)

The game ships to phones as a [Capacitor](https://capacitorjs.com) app that wraps the web build in `dist/`.

## Status

Capacitor is configured but there is **no native project yet**: `ios/` and `android/` don't exist, and the gaps below mean a native build wouldn't work against the live API. Treat this page as the setup guide plus a to-do list.

| Setting | Value |
|---------|-------|
| App ID | `com.idleaustin.smokebreak` |
| App name | Idle Smoke Break |
| Web directory | `dist` |
| Plugins | Haptics, Preferences |

Config lives in [`capacitor.config.ts`](../capacitor.config.ts). Platform-specific behavior sits behind [`src/platform/`](../src/platform): storage uses Capacitor Preferences on native and `localStorage` on the web, and haptics fall back to `navigator.vibrate`. Shifts record `platform` as `web`, `ios` or `android`.

## One-time setup

Requires Xcode (iOS, macOS only) and Android Studio (Android).

```bash
npm ci
BASE_URL=/ npm run build
npx cap add ios
npx cap add android
```

Commit the generated `ios/` and `android/` folders so signing and native settings are tracked.

## Daily workflow

```bash
BASE_URL=/ npm run mobile:sync   # build, then copy dist/ into both native projects
npm run ios:open                 # opens Xcode
npm run android:open             # opens Android Studio
```

Run from the IDE to a simulator or device.

## Gaps to close before the first native build

1. **Asset base path.** Vite's `base` defaults to `/idle-smoke/` for the web deployment. Capacitor serves `dist/` from the root of the app, so a default build points scripts and styles at paths that don't exist. Build with `BASE_URL=/`, as above. Consider a dedicated `mobile:build` script so nobody forgets.
2. **API origin.** The client calls relative URLs (`/api/v1/...`, built by `resolveApiPath` in `shiftClient.ts`). Inside the native app those resolve against the app itself, which has no server. The client needs an absolute API origin for native builds, for example a build-time variable pointing at the deployed Worker.
3. **CORS.** The Worker doesn't send CORS headers, and requests from the native webview to `idlemullet.com` are cross-origin. Add CORS handling for the Capacitor origins, or route requests through Capacitor's native HTTP.
4. **Apple and Google sign-in.** Both use a web popup flow with a redirect URI. It hasn't been verified inside a native webview, and a native sign-in plugin may be needed. See [`scripts/setup-oauth-wizard.sh`](../scripts/setup-oauth-wizard.sh) for the OAuth credentials.

## Release checklist

- The app ID must match the identifiers registered in the Apple Developer and Google Play consoles. Change it in `capacitor.config.ts` before registering if you want a different one.
- Configure code signing in Xcode and a keystore for Android, and keep signing material out of the repo (`.gitignore` already excludes `*.pem`, `*.key`, `*.p12`).
- Native version numbers (iOS marketing version and build number, Android `versionName` and `versionCode`) are separate from the web version derived by `scripts/version.mjs`. Bump them for each store submission.
- The backend, rate limits and account deletion are shared with the web app. Both stores expect an in-app way to delete an account, which `DELETE /api/v1/players/me` and the profile menu provide.

