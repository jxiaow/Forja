---
name: cross-platform-readiness
description: When checking toolchain readiness, use platform-specific requirements — Windows needs VS/jom, POSIX needs make
source: auto-skill
extracted_at: '2026-06-23T15:00:00.000Z'
---

# Cross-Platform Toolchain Readiness

When assessing whether a toolchain is ready for building, requirements differ by platform. A single "configured" check that works on one platform may fail on another if platform-specific tools are not detected.

## The Pattern

Toolchain readiness has two phases:
1. **Build summary** — detect what tools are available
2. **Assess readiness** — check if required tools exist for the current platform and target kind

### Platform-Specific Requirements

| Target Kind | Windows | POSIX (Linux/macOS) |
|-------------|---------|---------------------|
| Qt | Qt path + VS dev shell + (jom optional) | Qt path + make |
| SDK | VS dev shell (VsDevCmd.bat) | make |

### Build Summary Phase

Detect tools and populate a summary object. Use actual detection, not hardcoded assumptions:

```typescript
function buildToolchainSummary(workspace: string, target: ActiveTarget): ToolchainSummary {
    const summary: ToolchainSummary = {};
    if (target.kind === 'qt') {
        const qt = loadQtSettings(workspace);
        if (qt.qtPath) { summary.qt = { path: qt.qtPath }; }
        if (process.platform === 'win32') {
            if (qt.vsInstall) { summary.vs = { path: qt.vsInstall }; }
            if (qt.jomPath) { summary.jom = qt.jomPath; }
        } else {
            // POSIX: detect make, not VS
            summary.make = !!detectMake();
        }
    } else {
        // SDK
        if (process.platform === 'win32') {
            const sdk = loadSdkSettings(workspace);
            if (sdk.vsInstall) { summary.vs = { path: sdk.vsInstall }; }
        } else {
            // POSIX: SDK uses make, not VS
            summary.make = !!detectMake();
        }
    }
    return summary;
}
```

**Key rule**: Never hardcode `summary.make = true`. Always use actual detection (`detectMake()`, `which make`, etc.).

### Assess Readiness Phase

Check platform-specific requirements and provide platform-appropriate diagnostics:

```typescript
function assessToolchainReadiness(summary: ToolchainSummary, target: ActiveTarget, diagnostics: Diagnostic[]): ReadinessState {
    if (target.kind === 'qt') {
        if (!summary.qt?.path) {
            diagnostics.push({ code: 'toolchain.qtMissing', level: 'error', message: 'Qt not found' });
            return 'missing';
        }
        if (process.platform === 'win32') {
            // Windows Qt requires VS
            if (!summary.vs?.path) {
                diagnostics.push({ code: 'toolchain.vsMissing', level: 'error', message: 'VS dev environment not found' });
                return 'missing';
            }
            // jom is optional but recommended
            if (!summary.jom) {
                diagnostics.push({ code: 'toolchain.jomMissing', level: 'warning', message: 'jom not found (optional)' });
            }
        } else {
            // POSIX Qt requires make
            if (!summary.make) {
                diagnostics.push({ code: 'toolchain.makeMissing', level: 'error', message: 'make not found' });
                return 'missing';
            }
        }
        return 'configured';
    }
    // SDK: similar platform branching
    if (process.platform === 'win32') {
        if (!summary.vs?.path) { /* VS missing */ return 'missing'; }
    } else {
        if (!summary.make) { /* make missing */ return 'missing'; }
    }
    return 'configured';
}
```

### Next Actions Must Match Target Kind

When toolchain is missing, the suggested fix must match the active target:

```typescript
function buildNextActions(readiness: Readiness, target: ActiveTarget | null): string[] {
    if (readiness.toolchain === 'missing') {
        actions.push('forja doctor');
        if (target?.kind === 'sdk') {
            if (process.platform === 'win32') {
                actions.push('forja use sdk --vs-dev-cmd <path>');
            } else {
                actions.push('forja use sdk --project <path>');
            }
        } else {
            actions.push('forja use qt --qt-path <path>');
        }
    }
}
```

**Anti-pattern**: Always suggesting `forja use qt --qt-path <path>` regardless of target kind. SDK targets need SDK-specific fix suggestions.

### Text Output Must Show All Detected Tools

The text formatter must render all toolchain fields, including platform-specific ones:

```typescript
function formatStatusText(result: StatusResult): string {
    if (result.toolchain) {
        const tc = result.toolchain;
        const tcParts: string[] = [];
        if (tc.qt) { tcParts.push(`Qt ${tc.qt.path}`); }
        if (tc.vs) { tcParts.push(`VS ${tc.vs.path}`); }
        if (tc.jom) { tcParts.push('jom'); }
        if (tc.make) { tcParts.push('make'); }  // Don't forget POSIX make!
        if (tcParts.length > 0) { lines.push(`Toolchain: ${tcParts.join(', ')}`); }
    }
}
```

## Common Mistakes

1. **Hardcoding `summary.make = true`** — Always detect with `which make` or equivalent
2. **Requiring VS on POSIX** — VS is Windows-only; POSIX uses make
3. **Generic nextActions** — SDK targets need SDK-specific fix suggestions, not Qt suggestions
4. **Missing make in text output** — If make is detected, show it in status text
5. **Single readiness check for all platforms** — Branch on `process.platform` before checking tool-specific requirements

## Checklist

- [ ] Does `buildToolchainSummary` use actual detection for make (not hardcoded true)?
- [ ] Does `assessToolchainReadiness` branch on `process.platform`?
- [ ] Does Windows Qt require VS? Does POSIX Qt require make?
- [ ] Does Windows SDK require VS? Does POSIX SDK require make?
- [ ] Do nextActions match the active target kind (Qt vs SDK)?
- [ ] Does text output render all detected tools including make?
