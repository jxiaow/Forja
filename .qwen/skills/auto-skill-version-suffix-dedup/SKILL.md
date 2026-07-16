---
name: version-suffix-dedup
description: Build scripts that append channel suffixes to versions must check if the version already contains the suffix to avoid duplication; dev builds use date stamps; VSCode extensions have stricter version format requirements than npm
source: auto-skill
extracted_at: '2026-07-03T03:03:34.865Z'
---

# Version Suffix Deduplication and Date Stamping

## Problem 1: Suffix Duplication

When packaging scripts append a channel suffix (e.g. `-dev`) to the version string, if the version in `package.json` already contains that suffix (e.g. `0.7.55-dev`), the result is a duplicated suffix like `0.7.55-dev-dev`.

## Problem 2: Dev Build Identification

Dev builds need a date stamp so users can tell when a build was made. But the version format must be compatible with both npm (lenient) and VSCode extension packaging (strict).

## Solution: Date-Based Versioning

### Version Format

- `package.json` base version: `x.y.z.dev` (uses dot, not hyphen)
- CLI dev display version: `x.y.z.dev.YYYYMMDD` (e.g. `0.7.55.dev.20260703`)
- VSCode dev display version: `x.y.z-dev.YYYYMMDD` (e.g. `0.7.55-dev.20260703`)
- Stable: `x.y.z` (no suffix, no date)

### Why Two Formats?

VSCode's `vsce` packaging tool rejects versions like `0.7.55.dev.20260703` with "Invalid extension version". It requires the pre-release identifier to follow a hyphen: `0.7.55-dev.20260703` is valid. npm has no such restriction.

### Implementation

```js
// scripts/build-cli.js and scripts/package-vs.js

function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

// CLI: uses .dev.YYYYMMDDHHmm (npm compatible)
const dateSuffix = (channel === 'dev') ? `.${dateStamp()}` : '';
const displayVersion = `${version}${dateSuffix}`;

// VSCode: uses -dev.YYYYMMDDHHmm (vsce requires hyphen pre-release)
const vsDateSuffix = (channel === 'dev') ? `-dev.${dateStamp()}` : '';
const vsDisplayVersion = channel === 'dev'
    ? `${version.replace(/\.dev$/, '')}${vsdateSuffix}`
    : version;
```

### Why Include Hours and Minutes?

Dev builds may happen multiple times per day. Including only the date (YYYYMMDD) makes it impossible to distinguish between builds made on the same day. Adding hours and minutes (HHmm) provides minute-level precision, allowing users to identify exactly when a build was made.

Example: `0.7.55.dev.202607031430` means "built on July 3, 2026 at 14:30 (2:30 PM)".

### Version Patching in CLI Build

The CLI build patches `version.js` in the build output to include the date:

```js
if (dateSuffix && fs.existsSync(path.join(tmpBuild, 'version.js'))) {
    let vContent = fs.readFileSync(vFile, 'utf8');
    vContent = vContent.replace(
        /VERSION\s*=\s*["']([^"']+)["']/,
        `VERSION = "$1${dateSuffix}"`
    );
    fs.writeFileSync(vFile, vContent, 'utf8');
}
```

## Problem 3: Remote Version Comparison

When comparing local and remote Forja versions, the comparison must strip pre-release identifiers to compare base versions.

### Bug Pattern

```js
// WRONG — only strips hyphen suffixes, misses dot-based pre-release
const baseVersion = (v) => v.replace(/-[^-]+$/, '');
// '0.7.55.dev.20260703' → '0.7.55.dev.20260703' (no match!)
```

### Fix

```js
// CORRECT — extracts only the numeric x.y.z part
const baseVersion = (v) => v.match(/^\d+\.\d+\.\d+/)?.[0] ?? v;
// '0.7.55.dev.20260703' → '0.7.55'
// '0.7.55-dev.20260703' → '0.7.55'
// '0.7.55' → '0.7.55'
```

## displayName Deduplication

When packaging scripts patch `displayName` to add a channel label (e.g. `(Dev)`), check if it already contains the label to avoid doubling:

```js
// WRONG — always appends
pkg.displayName = `${pkg.displayName} (${ChannelLabel})`;

// CORRECT — check first
if (!pkg.displayName.includes(`(${ChannelLabel})`)) {
    pkg.displayName = `${pkg.displayName} (${ChannelLabel})`;
}
```

## Restore From Original, Not Regex Reverse

When a packaging script temporarily patches `package.json` (version, displayName), the `finally` block must restore from **saved original values** — never use regex to reverse the patch.

### Bug Pattern

```js
// WRONG — regex reverse assumes the patch always added " (Dev)"
// If the original was already "Forja (Dev)", the regex strips it to "Forja"
pkg.displayName = pkg.displayName.replace(/ \(Dev\)$/, '');
pkg.version = version; // `version` may already be polluted from a previous failed run
```

### Fix

```js
// CORRECT — save originals before any patching
const origDisplayName = pkg.displayName;
const origVersion = pkg.version;
try {
    // ... patch and package ...
} finally {
    if (patchedPkg) {
        pkg.displayName = origDisplayName;  // exact original
        pkg.version = origVersion;           // exact original
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    }
}
```

**Why:** Regex reverse is fragile — it can't distinguish "patch added this" from "original already had this". Saved originals are always correct.

## Where to Apply

- `scripts/package-vs.js` — VSCode extension packaging
- `scripts/build-cli.js` — CLI npm package packaging
- `remote/core/status.ts` — remote version comparison (`baseVersion` function)

## Checklist

1. Does the version in `package.json` already contain the channel suffix? → Don't re-append
2. Is the target npm or VSCode? → npm allows `.dev`, VSCode requires `-dev`
3. Does the date stamp function use the local date or UTC? → Use local date (consistent with developer expectation)
4. Does the remote version comparison handle both `-` and `.` pre-release formats? → Use regex to extract `x.y.z` numeric part
5. Does the displayName patch check for existing channel label? → Check before appending
6. Does the finally block restore from saved originals? → Never use regex to reverse patches
