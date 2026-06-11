# Security Policy

## Supported Versions

Security fixes are applied to the latest commit on the `main` branch. We do not maintain separate patch releases for older versions at this time.

| Version | Supported |
| ------- | --------- |
| `main` (latest) | Yes |
| Older branches | No |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues through one of the following channels:

1. **Email**: Send details to [security@zivtech.com](mailto:security@zivtech.com)
2. **GitHub Private Security Advisory**: Use [GitHub's private vulnerability reporting](https://github.com/zivtech/joyus-desktop/security/advisories/new) to submit a report confidentially

### What to Include

Please include as much of the following as possible to help us assess and address the issue quickly:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- Affected components (package, app, workflow)
- Any suggested remediation

### What to Expect

- We will acknowledge receipt within 5 business days
- We will keep you informed as we investigate and remediate
- We will credit reporters in release notes unless you prefer otherwise

## Threat Model

This project's threat model focuses on token replay, cross-tenant data access, policy bypass during control-plane outages, and artifact provenance tampering. See [docs/threat-model.md](docs/threat-model.md) for details.
