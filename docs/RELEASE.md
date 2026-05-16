# Release Guide

## Local Windows Build

```bash
npm run lint
npm run build
npm run tauri build
```

Build artifacts are created under:

```text
src-tauri/target/release/bundle/
```

On Windows this normally includes MSI and NSIS installers when the required
Tauri bundler tools are available.

The release executable is built as a Windows GUI app and should not open a
console window. For local one-click launch without a terminal, use `start.vbs`
instead of `start.cmd`.

## GitHub Release

1. Update `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   to the same version.
2. Run local checks.
3. Create a version tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions will build the Windows installer and attach it to a draft
   release.

## Signing

The current workflow produces unsigned Windows installers. Unsigned apps can
trigger Windows SmartScreen warnings. Add code signing later when you have a
certificate and are ready to publish broadly.
