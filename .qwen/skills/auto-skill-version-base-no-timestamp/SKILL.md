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

## Rules

1. `package.json` version must always be `X.Y.Z.dev` for dev builds, `X.Y.Z` for stable
2. Never commit a timestamped version to `package.json`
3. If `forja --version` shows two timestamps, check `package.json` — it was likely left dirty by an interrupted build
4. Fix: reset `package.json` version to `X.Y.Z.dev` and rebuild
