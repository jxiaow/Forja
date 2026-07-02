---
name: version-suffix-dedup
description: Build scripts that append channel suffixes to versions must check if the version already contains the suffix to avoid duplication (e.g. 0.7.55-dev-dev)
source: auto-skill
extracted_at: '2026-07-02T08:24:10.111Z'
---

# Version Suffix Deduplication

## Problem

When packaging scripts append a channel suffix (e.g. `-dev`) to the version string, if the version in `package.json` already contains that suffix (e.g. `0.7.55-dev`), the result is a duplicated suffix like `0.7.55-dev-dev`.

## Fix

Before appending the channel suffix, check if the version already ends with it:

```js
// BAD — always appends, causing duplication
const versionSuffix = channel === 'stable' ? '' : `-${channel}`;

// GOOD — skips if version already ends with the channel suffix
const versionSuffix = (channel === 'stable' || version.endsWith(`-${channel}`)) ? '' : `-${channel}`;
```

## Where to Apply

- `scripts/package-vs.js` — VSCode extension packaging (vsix filename and patched package.json version)
- `scripts/build-cli.js` — CLI npm package packaging (tgz filename, patched CLI package.json version, and version.js patching)

## Rule

When a project uses pre-release version tags in `package.json` (e.g. `x.y.z-dev`), packaging scripts must not blindly append the channel name as a suffix. Always check `version.endsWith(`-${channel}`)` first.
