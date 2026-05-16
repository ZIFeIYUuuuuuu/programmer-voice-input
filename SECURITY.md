# Security Policy

## Supported Versions

Only the latest release is supported for security fixes.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if the repository is hosted
there. Do not include API keys, transcripts, or audio samples in public issues.

## Local Secrets

DashScope API keys are user-provided and stored in the local app data directory
by the app. The key is never hardcoded in source code and should never be
committed to the repository.

To remove local app settings, close the app and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/clear-local-secrets.ps1
```
