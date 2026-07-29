---
name: no-silent-defaults
description: Multi-option fields (mode, arch, etc.) must prompt user in interactive mode, return questions in JSON/CI mode, and use answers in answers mode — never silently apply defaults
source: auto-skill
extracted_at: '2026-07-03T10:03:14.898Z'
---

# No Silent Defaults for Multi-Option Fields

When a configuration field has multiple valid options (e.g., mode: debug/release, arch: x86/x64), the system must NEVER silently apply a default value. The user must explicitly choose.

## Three-Mode Pattern

Every multi-option field must support all three CLI interaction modes:

| Mode | Condition | Behavior |
|------|-----------|----------|
| Interactive | `options.interactive` && no flag | Prompt with `choose()` |
| Answers | `--json --answers` | Read from answers JSON |
| CI | `--json` (no answers) | Return as `Question` in `needs-input` response |
| Flag | `--mode <value>` | Use flag value directly |

## Implementation Pattern

### 1. No silent fallback in variable initialization

```typescript
// BAD: silently defaults to 'release'
const defaultMode = (options.mode || 'release') as 'debug' | 'release';

// GOOD: undefined until explicitly resolved
const defaultMode = options.mode as 'debug' | 'release' | undefined;
```

### 2. Resolve through the three modes

```typescript
let resolvedMode = options.mode;  // flag or answer

// Interactive: prompt user
if (!resolvedMode && !existingConfig.mode && options.interactive) {
    const chosen = await choose(T('prompt.selectMode'), modes, m => m.value);
    if (chosen) resolvedMode = chosen.value;
}

// Final value: resolved or existing, may still be undefined
const effectiveMode = resolvedMode || existingConfig.mode;
```

### 3. Only save when resolved

```typescript
// BAD: always saves, even with silent default
if (options.reset || !qt.mode) { qt.mode = defaultMode; changed = true; }

// GOOD: only saves when we have an actual value
if ((options.reset || !qt.mode) && effectiveMode) { qt.mode = effectiveMode; changed = true; }
```

### 4. JSON/CI mode returns questions for missing fields

```typescript
if (options.json && !answers) {
    const hasTargets = (detected.qtTargets + (detected.sdkTargets ?? 0)) > 0;
    const needsMode = hasTargets && !config.mode;
    const needsArch = hasTargets && process.platform === 'win32' && !config.arch;
    if (needsMode || needsArch) {
        result.status = 'needs-input';
        result.questions = filterQuestions(config);  // mode/arch included
        return result;
    }
}
```

**Important:** `needsMode`/`needsArch` must be gated by `hasTargets`. An empty workspace (0 targets) should NOT require mode/arch — there's nothing to build yet.

### 4b. Ambiguous target in JSON mode → needs-input

When target selection is ambiguous (multiple targets, no `--project`) in JSON mode without answers:

```typescript
if (initResult.ambiguous) {
    if (options.json && !answers) {
        result.ok = false;
        result.status = 'needs-input';
        result.questions = filterLocalQuestions(initResult, ...);
        result.nextAction = 'forja setup --json --answers <answers.json>';
    }
}
```

Without this, ambiguous targets silently succeed with `ok: true` and a misleading `nextAction`.

### 5. Guard downstream usage

If a struct requires non-optional fields (like `ActiveTarget.mode: 'debug' | 'release'`), guard creation:

```typescript
// Only create target when all required fields are resolved
if (targetMode && targetArch) {
    activeTarget = { mode: targetMode, arch: targetArch, ... };
}
// Otherwise: activeTarget stays undefined, setup returns needs-input
```

## Platform-Specific Options

Some fields only have multiple options on certain platforms:
- **arch**: Windows has x86/x64 (prompt); Linux/macOS has single native arch (auto, no prompt)

```typescript
if (!resolvedArch && os.platform() === 'win32') {
    // prompt for arch
}
// On Linux/macOS: effectiveArch = platformDefaultArch (no prompt needed)
```

## Toolchain Path Selection

Toolchain paths (Qt, VS) follow the same multi-option principle. When detection finds multiple candidates:

| Candidates | Interactive | Non-interactive |
|------------|-------------|-----------------|
| 0 | Warning | Warning |
| 1 | Auto-select | Auto-select |
| 2+ | `choose()` prompt | Leave undefined → `needs-input` + questions |

```typescript
// GOOD: don't auto-select first when multiple candidates exist
if (env.qt) {
    result.qtPath = env.qt.path;
    if (qtCandidates.length > 1) {
        result.qt = false;        // leave unresolved
        result.qtPath = undefined; // for questions mechanism
    }
}

// Interactive: prompt user to choose
if (!options.qtPath && !existingConfig.qtPath && qtCandidates.length > 1 && options.interactive) {
    const chosen = await choose(T('selectQt'), qtCandidates, q => `${q.version} — ${q.path}`);
    if (chosen) { result.qtPath = chosen.path; }
}
```

Pass candidate lists through the result so `filterQuestions` can populate `choices` for JSON/CI mode.

## Checklist

- [ ] Are there any `|| 'defaultValue'` patterns for multi-option fields?
- [ ] Does each multi-option field support all three modes (interactive/answers/CI)?
- [ ] Are config saves guarded with `&& effectiveValue` to avoid saving undefined?
- [ ] Does the JSON mode return `needs-input` + questions when fields are unresolved?
- [ ] Are downstream structs (that require non-optional fields) guarded against undefined?
- [ ] Are platform-specific options (like arch on non-Windows) auto-resolved without prompting?
- [ ] Do toolchain paths with multiple candidates prompt in interactive mode and leave undefined in CI mode?
- [ ] Are candidate lists passed through the result for question `choices` population?
