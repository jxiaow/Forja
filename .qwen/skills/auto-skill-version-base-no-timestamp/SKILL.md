---
name: version-base-no-timestamp
description: package.json version must be the base version (e.g. 0.7.55.dev) — packaging scripts append timestamps at build time, never bake them into package.json
source: auto-skill
extracted_at: '2026-07-06T07:17:14.282Z'
---

# Version Base Must Not Contain Timestamp

`package.json` version must be the base version without a build timestamp. Packaging scripts (`scripts/package-vs.js`, `scripts/build-cli.js`) append timestamps at build time. If `package.json` already contains a timestamp, the output gets a double timestamp.

## The Problem

`package-vs.js` patches `package.json` version during VSIX packaging and restores it in a `finally` block. If the build is interrupted, `package.json` is left with the patched version (e.g., `0.7.55-dev.202607061100`). Next build reads this as the base version and appends another timestamp → `0.7.55-dev.202607061100.202607061503`.

## Correct Version Format

```json
{
  "version": "0.7.55.dev"
}
```

Packaging scripts produce:
- VSIX: `0.7.55-dev.202607061515` (dash before dev, then timestamp)
- CLI: `0.7.55.dev.202607061516` (dot before dev, then timestamp)

## Root Cause: Restore Logic Must Save Originals

`package-vs.js` temporarily patches `package.json` (version + displayName) for vsce, then restores in a `finally` block. The original restore logic used **regex reversal** which was buggy:

```js
// WRONG — regex reversal fails when original already contains the suffix
pkg.displayName = pkg.displayName.replace(/ \(Dev\)$/, '');  // strips "(Dev)" even if it was in the ORIGINAL
pkg.version = version;  // `version` was captured before patching, BUT if package.json was already dirty from a previous failed run, `version` IS the dirty value
```

Two bugs:
1. If `package.json` displayName was already `"Forja (Dev)"` (the committed value), the patch step skips adding `(Dev)` (due to `includes` check), but the restore regex strips it anyway → `"Forja"`
2. If `package.json` version was already polluted from a previous run, `version` captures the polluted value, so "restore" writes back the polluted value

### Correct Pattern

```js
// CORRECT — save originals BEFORE any modification
const origDisplayName = pkg.displayName;
const origVersion = pkg.version;
try {
    // ... patch and build ...
} finally {
    if (patchedPkg) {
        pkg.displayName = origDisplayName;  // restore from saved original
        pkg.version = origVersion;
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    }
}
```

## Rules

1. `package.json` version must always be `X.Y.Z.dev` for dev builds, `X.Y.Z` for stable
2. Never commit a timestamped version to `package.json`
3. If `forja --version` shows two timestamps, check `package.json` — it was likely left dirty by an interrupted build
4. Fix: reset `package.json` version to `X.Y.Z.dev` and rebuild
5. Temp-modify-restore patterns MUST save original values before modification and restore from saved copies — never use regex reversal
