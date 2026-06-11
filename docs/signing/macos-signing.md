# macOS Code Signing & Notarization

Tauri handles signing and notarization automatically when the environment variables below are set
during `cargo tauri build`. For local development, unsigned builds are acceptable.

## Prerequisites

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. Create a **Developer ID Application** certificate in Xcode or at
   [certificates.apple.com](https://developer.apple.com/account/resources/certificates/list).
3. Export the certificate as a `.p12` file (Keychain Access → right-click → Export).
4. Create an **app-specific password** at [appleid.apple.com](https://appleid.apple.com) for
   notarization (used as `APPLE_PASSWORD`).

## Environment variables (CI/CD)

| Variable | Description |
|----------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file: `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting the `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | 10-character Team ID shown in the Developer portal |

## How it works

When all five variables are present, Tauri will:

1. Import the certificate into a temporary keychain.
2. Sign the app bundle and all embedded binaries with `codesign`.
3. Submit the `.dmg` to Apple's notarization service (`notarytool`).
4. Staple the notarization ticket so Gatekeeper passes without internet access.

## Local development

Unsigned builds work in developer mode. If Gatekeeper blocks the app:

```bash
xattr -dr com.apple.quarantine /Applications/Joyus\ Desktop.app
```

Or enable **System Settings → Privacy & Security → Allow apps from identified developers**.

## Verifying a signed build

```bash
codesign --verify --deep --strict --verbose=2 "Joyus Desktop.app"
spctl --assess --type exec -vv "Joyus Desktop.app"
```
