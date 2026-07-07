---
name: interactive-setup-ux
description: Multi-step interactive setup must have step numbering [N/M], echo-back after each choice, required selections loop until valid, and config summary with versions
source: auto-skill
extracted_at: '2026-07-05T02:19:11.946Z'
---

# Interactive Setup UX

When presenting a multi-step interactive configuration flow (e.g., `forja setup`), the UX must provide clear progress indication, feedback, and enforce completeness.

## Four Requirements

### 1. Step Numbering [N/M]

Every prompt must show which step it is and how many total steps there are:

```
[1/5] 选择目标项目
  [1] qt_linux_pc_client — qt_linux_pc_client/qt_linux_pc_client.pro
  ...
请选择:
```

Pre-compute total steps before any prompts fire:

```typescript
const willPromptTarget = needTargetResolution && totalTargets > 1 && options.interactive;
const willPromptQt = !options.qtPath && !existingQt.qtPath && qtCandidates.length > 1 && options.interactive;
const willPromptMode = !flagMode && !existingTarget?.mode && options.interactive;
// ... etc
const totalSteps = [willPromptTarget, willPromptQmake, willPromptQt, willPromptVs, willPromptMode, willPromptArch].filter(Boolean).length;
const tracker = { current: 0, total: totalSteps };
```

For dynamic steps (e.g., qmake TARGET only appears for .pro files), pre-compute with an over-approximation and adjust down if not triggered:

```typescript
const hasProCandidate = candidates.some(c => c.project.endsWith('.pro'));
const willPromptQmake = hasProCandidate && !existingQt.target && options.interactive;
// Include in total pre-computation
const totalSteps = [willPromptTarget, willPromptQmake, ...].filter(Boolean).length;

// If pre-computed but not actually triggered, adjust down
if (willPromptQmake && !selectedPro) {
    tracker.total--;
}
```

### 2. Echo-Back After Each Choice

After the user selects, immediately show what was chosen with a ✓ prefix:

```
请选择: 1
  ✓ qt_linux_pc_client — qt_linux_pc_client/qt_linux_pc_client.pro

[2/5] 选择 Qt 安装
```

### 3. Required Selections Use `chooseRequired`

Required configuration items (target, Qt, VS, mode, arch) must NOT have skip/cancel options. Use `chooseRequired` which loops until the user makes a valid selection:

```typescript
export async function chooseRequired<T>(message: string, choices: T[], format: (item: T) => string): Promise<T> {
    while (true) {
        const result = await choose(message, choices, format);
        if (result !== null) return result;
        console.log(T('cmd.chooseRequired'));  // "请选择一个选项"
    }
}
```

Usage:

```typescript
tracker.current++;
const chosen = await chooseRequired(
    `[${tracker.current}/${tracker.total}] ${T('init.selectTarget')}`,
    candidates,
    c => `${c.label} — ${c.project}`,
);
console.log(`  ✓ ${chosen.label} — ${chosen.project}`);
```

**Only truly optional items** (like qmake TARGET, which has a .pro default) may use text input with "回车跳过" hint:

```typescript
const answer = await prompt(`[${step}/${total}] QMake TARGET (回车跳过: ${defaultTarget})`);
```

### 4. Config Summary After Interactive Flow

After all prompts complete, show a config summary so the user can verify their choices:

```
本地：
  已配置 (Qt ✓, VS ✓, jom ✓)
  19 Qt + 0 SDK 个目标
  目标: qt_linux_pc_client/qt_linux_pc_client.pro
  Qt (5.15.13): C:\QtCompile\msvc2019-accessible
  VS (2026): C:\Program Files\Microsoft Visual Studio\2022\Community
  模式/架构: release | x86
```

Version format: parentheses after label — `Qt (5.15.13): <path>`. Not space-separated, not em-dash-separated.

## No Default Values on `choose()`

The `choose()` function must NOT have a default value — pressing Enter should return null (triggering re-prompt via `chooseRequired`), not auto-select option 1:

```typescript
// BAD: pressing Enter selects option 1
const answer = await prompt(T('cmd.choosePrompt'), '1');

// GOOD: pressing Enter returns null → chooseRequired re-prompts
const answer = await prompt(T('cmd.choosePrompt'));
if (!answer) return null;
```

## Toolchain Warnings: Detected vs Missing

Only warn "未检测到" when there are truly NO candidates on the system. If candidates exist but user was prompted and selected (or there was only one), don't warn:

```typescript
function addToolchainWarnings(diagnostics, toolchain) {
    // Only warn if no candidates AND not detected
    if (!toolchain.qt && toolchain.qtCandidates.length === 0) {
        diagnostics.push({ level: 'warning', message: T('init.qtMissing') });
    }
    if (!toolchain.vs && toolchain.vsCandidates.length === 0) {
        diagnostics.push({ level: 'warning', message: T('init.vsMissing') });
    }
}
```

## nextAction Must Not Be Overridden

When init.ts sets nextAction based on config completeness, the caller (setup.ts) must NOT unconditionally override it:

```typescript
// BAD: always overrides, ignoring init.ts's decision
if (initResult.ambiguous) { ... }
else { result.nextAction = 'forja build'; }  // overrides 'forja setup' from init.ts

// GOOD: only set default when init.ts didn't set one
if (initResult.ambiguous) { ... }
else if (!result.nextAction) { result.nextAction = 'forja build'; }
```

## Config Echo on Re-Run

When re-running setup on an already-configured workspace, echo current values before the prompts (or before the summary if nothing needs prompting). Echo must NOT be guarded by `options.interactive` — always show existing values:

```typescript
// Always echo (no interactive guard)
if (existingActiveTarget) {
    console.log(`  ${T('init.currentTarget')}: ${existingActiveTarget.project}`);
}
if (existingQt.qtPath) {
    const ver = toolchain.qtVersion ? ` (${toolchain.qtVersion})` : '';
    console.log(`  ${T('setupSummaryQt')}${ver}: ${existingQt.qtPath}`);
}
// ... VS, jom, mode/arch
```

**Dedup with summary:** The echo shows full config details (Qt version+path, VS version+path, jom path, mode/arch). The summary section (`formatLocalSection`) should NOT repeat these — it only shows status + counts + target name:

```
  当前目标: qt_linux_pc_client/qt_linux_pc_client.pro   ← echo
  Qt (5.15.13): C:\QtCompile\msvc2019-accessible        ← echo
  VS (2026): C:\Program Files\...\2022\Community         ← echo
  模式/架构: release | x86                                ← echo
Forja 初始化
本地：
  已配置 (Qt ✓, VS ✓, jom ✓)                             ← summary (status only)
  23 Qt + 26 SDK 个目标                                   ← summary (counts only)
  目标: qt_linux_pc_client/qt_linux_pc_client.pro         ← summary (target only)
```

## Reset Must Clear All Layers

When `--reset` is used, ALL `willPrompt*` conditions must fire — not just the primary one (target). Each condition must check `options.reset`:

```typescript
// BAD: only target checks reset
const willPromptTarget = needTargetResolution && ...;  // needTargetResolution includes reset
const willPromptMode = !flagMode && !existingTarget?.mode && options.interactive;  // ignores reset!

// GOOD: every condition checks reset
const willPromptQt = (options.reset || !existingQt.qtPath) && ...;
const willPromptVs = (options.reset || (!existingQt.vsInstall && !existingSdk.vsInstall)) && ...;
const willPromptMode = (options.reset || (!existingActiveTarget?.mode && !existingQt.mode)) && ...;
const willPromptArch = (options.reset || (!existingActiveTarget?.arch && !existingQt.arch)) && ...;
```

**Also:** `effectiveMode`/`effectiveArch` fallback chains must NOT fall back to existing config when reset=true:

```typescript
// BAD: reset still falls back to existing config
const effectiveMode = resolvedMode || existingActiveTarget?.mode || existingQt.mode;

// GOOD: reset blocks fallback
const effectiveMode = resolvedMode || (options.reset ? undefined : (existingActiveTarget?.mode || existingQt.mode));
```

## Config Value Fallback Chain

When reading config values (mode, arch), check multiple sources in priority order:

```
flag/answer → user prompt result → existingActiveTarget → existingQt/existingSdk → platform default
```

```typescript
const effectiveMode = resolvedMode || (options.reset ? undefined : (existingActiveTarget?.mode || existingQt.mode));
const effectiveArch = resolvedArch || (options.reset ? undefined : (existingActiveTarget?.arch || existingQt.arch))
    || (os.platform() !== 'win32' ? platformDefaultArch : undefined);
```

On non-Windows, arch has only one value (native) — always auto-resolve, never prompt.

## Checklist

- [ ] Does every prompt show `[N/M]` step numbering?
- [ ] Is totalSteps pre-computed before any prompts fire (including dynamic steps)?
- [ ] Are required selections using `chooseRequired` (no skip option)?
- [ ] Is there echo-back (✓) after each choice?
- [ ] Does `choose()` have no default value (Enter = re-prompt)?
- [ ] Is there a config summary with versions in parentheses after all prompts?
- [ ] Do toolchain warnings only fire when candidates.length === 0?
- [ ] Does setup.ts avoid overriding nextAction set by init.ts?
- [ ] Does re-running setup on configured workspace echo current values (target/Qt/VS/jom/mode/arch)?
- [ ] Is echo NOT guarded by `options.interactive`?
- [ ] Does the summary avoid duplicating details already shown in the echo?
- [ ] Does `--reset` make ALL willPrompt conditions fire (not just target)?
- [ ] Does `--reset` block fallback to existing config in effectiveMode/effectiveArch?
- [ ] Does the config fallback chain check: flag → prompt → activeTarget → domain settings → platform default?
