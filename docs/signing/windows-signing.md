# Windows Authenticode Signing

Tauri uses `signtool.exe` to sign the NSIS installer and the embedded binaries when the
environment variables below are present during `cargo tauri build`.

## Certificate types

| Type | SmartScreen reputation | Cost |
|------|----------------------|------|
| OV (Organisation Validation) | Builds slowly over time | ~$200–$400/year |
| EV (Extended Validation) | Immediate green reputation | ~$400–$700/year |

EV certificates are recommended for new publishers — SmartScreen blocks unsigned or OV-signed
binaries from unknown publishers by default.

## Obtaining a certificate

Purchase from a Microsoft-trusted CA such as DigiCert, Sectigo, or GlobalSign. EV certificates
are delivered on a hardware token (USB) or via cloud-signing services (e.g. DigiCert KeyLocker).

## Environment variables (CI/CD)

| Variable | Description |
|----------|-------------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` file: `certutil -encode cert.pfx out.b64` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password protecting the `.pfx` |

For EV / cloud-signing, set `certificateThumbprint` in `tauri.conf.json` and configure
`signtool.exe` with the appropriate CSP provider instead of using the env vars above.

## How it works

When the variables are present, Tauri imports the certificate into the Windows certificate store
and calls `signtool.exe /tr http://timestamp.digicert.com /td sha256 /fd sha256` on each binary
and the final installer.

## Local development

Unsigned builds run locally with a SmartScreen warning ("Unknown publisher"). Click
**More info → Run anyway** to proceed. This warning disappears for signed releases after the
publisher builds reputation.

## Verifying a signed build

```powershell
Get-AuthenticodeSignature "Joyus Desktop_0.1.0_x64-setup.exe" | Select-Object Status, SignerCertificate
```

Expected: `Status = Valid`.
