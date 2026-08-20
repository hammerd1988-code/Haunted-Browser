# Code Signing Haunted Browser

Haunted Browser can build unsigned installers without credentials. Public releases should be signed so users can verify the publisher and operating systems can validate that an installer has not been modified.

This guide covers Windows Authenticode signing, macOS Developer ID signing and notarization, GitHub Actions secrets, and release verification. The current workflow deliberately produces unsigned artifacts until signing credentials are configured.

## Security Rules

- Never commit a `.pfx`, `.p12`, private key, certificate password, Apple app-specific password, or notarization credential.
- Store CI credentials as [GitHub Actions repository or environment secrets](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions).
- Base64 is encoding, not encryption. Treat encoded certificate data as a private key.
- Prefer a protected GitHub environment such as `release-signing`, with required reviewers, for signing secrets.
- Restrict certificate access to release maintainers and rotate credentials before expiration.
- If a credential is exposed, revoke or rotate it immediately, remove it from Git history, and replace affected release artifacts.

## Windows Authenticode Signing

[electron-builder supports Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/) through a PKCS#12 certificate and the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` environment variables.

### Obtain a certificate

Acquire a publicly trusted code-signing certificate from a certificate authority that supports Microsoft Authenticode.

- An organization validation certificate that can be exported as a password-protected `.pfx` is the simplest option for this GitHub Actions workflow.
- Some extended validation certificates require a hardware token, HSM, or cloud signing service and cannot be exported. Those require the provider's signing integration instead of `WIN_CSC_LINK`.
- The certificate subject becomes the publisher name shown by Windows. Confirm it is correct before publishing.

### Export and encode the certificate

Export the certificate with its private key as a password-protected `.pfx`. On PowerShell, create a one-line base64 value:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("windows-code-signing.pfx")
) | Set-Content -NoNewline "windows-code-signing.base64.txt"
```

On Linux or Git Bash:

```bash
base64 -w 0 windows-code-signing.pfx > windows-code-signing.base64.txt
```

Do not add either file to Git.

### Add GitHub secrets

Open the repository's **Settings > Secrets and variables > Actions**, then add:

| Secret | Value |
| --- | --- |
| `WIN_CSC_LINK` | One-line base64 contents of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` export password |

The same secrets can be entered from an authenticated GitHub CLI session:

```bash
gh secret set WIN_CSC_LINK < windows-code-signing.base64.txt
gh secret set WIN_CSC_KEY_PASSWORD
```

The second command prompts securely for the password.

### Connect signing to the release job

Add the Windows secrets to the installer step in `.github/workflows/release.yml`. The explicit `WIN_CSC_*` values work while certificate auto-discovery remains disabled:

```yaml
- name: Build installer
  run: ${{ matrix.command }}
  env:
    CSC_IDENTITY_AUTO_DISCOVERY: "false"
    WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

electron-builder signs the application executable and NSIS installer when valid credentials are present. After the first successful signed release, consider adding this property under the top-level `build` object in `package.json`:

```json
"forceCodeSigning": true
```

Do not enable `forceCodeSigning` before the credentials are configured because it intentionally fails unsigned builds.

### Timestamping

Signing should use SHA-256 and an RFC 3161 timestamp so the signature remains valid after the certificate expires. [Microsoft's Authenticode timestamping documentation](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures) describes the timestamp flow. electron-builder normally configures timestamping; a custom signing hook should use the certificate provider's RFC 3161 URL and SHA-256 for both digests.

An equivalent manual SignTool command looks like:

```powershell
signtool sign /f windows-code-signing.pfx /p "$env:PFX_PASSWORD" `
  /fd SHA256 /tr "https://timestamp.example-ca.com" /td SHA256 `
  "Haunted Browser-1.0.0-windows-x64.exe"
```

Replace the example timestamp URL with the URL supplied by the certificate authority. Do not put the real password in a script.

### Verify a Windows release

Run these checks on the final uploaded installer:

```powershell
Get-AuthenticodeSignature ".\Haunted Browser-1.0.0-windows-x64.exe" |
  Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate

signtool verify /pa /all /v ".\Haunted Browser-1.0.0-windows-x64.exe"
```

The signature status should be `Valid`, the signer should match the intended organization, and a timestamp certificate should be present. [Microsoft documents SignTool verification options](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).

A valid signature identifies the publisher and protects artifact integrity. It does not guarantee that Microsoft SmartScreen reputation warnings disappear immediately because reputation can take time to develop.

## macOS Developer ID Signing and Notarization

Apps distributed outside the Mac App Store should use a **Developer ID Application** certificate. Apple describes this distribution model in its [Developer ID documentation](https://developer.apple.com/developer-id/). The app should also use the Hardened Runtime and be notarized before distribution.

### Apple prerequisites

1. Join the Apple Developer Program.
2. Create a **Developer ID Application** certificate for the appropriate team.
3. Install the certificate and private key in Keychain Access on a trusted Mac.
4. Export the certificate and private key together as a password-protected `.p12`.
5. Create an app-specific password for the Apple ID used for notarization.
6. Record the 10-character Apple Developer Team ID.

Do not use an Apple Distribution, Mac App Distribution, or development certificate for direct Developer ID distribution.

### Encode the certificate

On macOS:

```bash
base64 -i developer-id-application.p12 -o mac-certificate.base64.txt
tr -d '\n' < mac-certificate.base64.txt > mac-certificate-one-line.txt
```

Delete both generated text files after configuring the secret.

### Add GitHub secrets

Add these repository or protected-environment secrets:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | One-line base64 contents of the `.p12` |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` export password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password, not the normal Apple ID password |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |

### Add Electron entitlements

Create `build-resources/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
```

Keep Electron runtime entitlements as narrow as possible. Add others only when a tested feature requires them.

### Configure the current electron-builder version

This repository uses electron-builder 25.1.8. Add the signing properties to the existing `build.mac` object in `package.json`:

```json
"mac": {
  "artifactName": "${productName}-${version}-macos-${arch}.${ext}",
  "target": ["dmg"],
  "category": "public.app-category.utilities",
  "hardenedRuntime": true,
  "entitlements": "build-resources/entitlements.mac.plist",
  "entitlementsInherit": "build-resources/entitlements.mac.plist",
  "notarize": true
}
```

These keys match the repository's current electron-builder generation. Check the [electron-builder macOS signing guide](https://www.electron.build/docs/features/code-signing/) before a future major-version upgrade because the configuration shape may change.

### Connect signing and notarization to the release job

Expose the macOS secrets only to the macOS build. Splitting macOS into its own job is the cleanest option; that installer step needs:

```yaml
env:
  CSC_IDENTITY_AUTO_DISCOVERY: "false"
  CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

electron-builder can use these credentials to sign and notarize the app. Its [notarization documentation](https://www.electron.build/docs/notarization/) lists the supported Apple credential variables. Apple requires `notarytool` for modern notarization; `altool` is obsolete for this purpose ([Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).

For local notarization, credentials can be stored in Keychain instead of shell history:

```bash
xcrun notarytool store-credentials "haunted-browser-notary" \
  --apple-id "YOUR_APPLE_ID" \
  --team-id "YOUR_TEAM_ID" \
  --password "YOUR_APP_SPECIFIC_PASSWORD"
```

Use placeholders interactively. Do not commit a command containing real credentials.

### Verify a macOS release

Mount the DMG, install the app, then run:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Haunted Browser.app"
codesign -dv --verbose=4 "/Applications/Haunted Browser.app"
spctl --assess --type execute --verbose=4 "/Applications/Haunted Browser.app"
xcrun stapler validate "Haunted Browser-1.0.0-macos-arm64.dmg"
```

Repeat the stapler check for the x64 DMG. The output should identify a Developer ID Application signer, show the Hardened Runtime, pass Gatekeeper assessment, and validate the stapled notarization ticket. Apple's [notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) explains submission and ticket stapling.

Test the arm64 DMG on Apple Silicon and the x64 DMG on Intel hardware or an appropriate Intel test environment.

## Recommended CI Rollout

1. Add a protected `release-signing` GitHub environment and required reviewers.
2. Store the Windows and Apple secrets in that environment.
3. Add the entitlements and electron-builder macOS settings.
4. Split platform builds so each signing job receives only its own secrets.
5. Create a prerelease tag and inspect all signing and notarization logs.
6. Download artifacts from GitHub Releases and run the verification commands above.
7. Enable `forceCodeSigning` only after signed builds are reliable.
8. Protect release tags and limit who can approve the signing environment.

Do not print secret values during diagnostics. GitHub masks exact secret values in logs, but transformed forms can still leak.

## Release Checklist

### Windows

- [ ] Final installer signature is valid
- [ ] Publisher name is correct
- [ ] SHA-256 timestamp is present
- [ ] Installer launches on a clean Windows machine
- [ ] Auto-update succeeds from the previous signed release

### macOS

- [ ] App is signed by the intended Developer ID Application identity
- [ ] Hardened Runtime is enabled
- [ ] `codesign --verify` passes
- [ ] `spctl --assess` passes
- [ ] Notarization succeeds
- [ ] Ticket is stapled and validates
- [ ] arm64 and x64 DMGs launch on their target architectures
- [ ] Auto-update succeeds from the previous signed release

