---
name: cli-text-format-consistency
description: Standardize CLI text output format across all command formatters — consistent separators, translated labels, no hardcoded strings
source: auto-skill
extracted_at: '2026-06-26T10:21:59.292Z'
---

# CLI Text Output Format Consistency

When improving or standardizing CLI text output across multiple command formatters, follow this process to ensure visual consistency.

## When This Applies

- User says output "looks messy" or "inconsistent"
- Adding a new command formatter
- Refactoring text output across commands
- Mixing separators (`·`, `:`, `=`, `→`, `/`) inconsistently

## Process

### 1. Audit All Formatters

Read every `formatXxxText` / `outputXxxResult` text output function across all command files. For each, catalog:
- What separator is used between label and value (space, `: `, `=`, etc.)
- Whether labels come from T() or are hardcoded
- Whether T() keys include trailing punctuation (colon) or not
- Whether there are double-punctuation bugs (e.g., T() has `：` and code adds `: `)

### 2. Define the Format Rules

Establish consistent rules. Example (方案 A):
- **Labels**: T() keys contain localized colon (`zh: ：`, `en: :`). Code uses `${T('label')}${value}` — no extra separator.
- **Status indicators**: Use `=` for key=value pairs (e.g., readiness: `目标=就绪`)
- **Directional**: Use `→` only for directional semantics (e.g., sync target)
- **Grouping**: Use `·` for inline grouping (e.g., `kind · mode/arch · runAt`)
- **No hardcoded labels**: All user-visible labels go through T()

### 3. Fix the Translation Table First

Before touching formatters, ensure T() has all needed keys:
- Labels with colons for every user-visible field
- Readiness/state key translations (not just values)
- Section-specific labels (setup steps, env tools, config fields)

```typescript
// In types.ts UI table:
readinessTarget:    { en: 'target',     zh: '目标' },
toolchainLabel:     { en: 'Toolchain:',  zh: '工具链：' },
qtLabel:            { en: 'Qt:',         zh: 'Qt：' },
```

### 4. Update Each Formatter Systematically

For each formatter file:
1. Replace `${T('label')} ${value}` → `${T('label')}${value}` (if T() has colon)
2. Replace `${T('label')}: ${value}` → `${T('label')}${value}` (fix double-colon)
3. Replace hardcoded `'Qt:'` → `${T('qtLabel')}`
4. Replace `locale === 'zh' ? '中文' : 'English'` → `${T('key')}`
5. Use `shortPath()` helper for long paths (show basename only)

### 5. Cross-File Consistency Check

After updating all formatters, grep for remaining inconsistencies:
```
grep -rn 'T(.*}: ' src/cli/commands/     # double-colon bug
grep -rn "locale === 'zh'" src/cli/      # inline locale checks
grep -rn '`  Qt:' src/cli/commands/       # hardcoded labels
```

## Common Bugs Found

| Bug | Pattern | Fix |
|-----|---------|-----|
| Double colon | `${T('doctor')}: ${action}` where T() = `诊断：` | Remove `: ` from code |
| Hardcoded English | `Qt:`, `VS:`, `jom:` in list env | Add T() keys, use `${T('qtLabel')}` |
| Inline locale | `locale === 'zh' ? '本地:' : 'Local:'` | Add T() key, use `${T('setupLocal')}` |
| Space after colon | `${T('workspace')} ${path}` produces `工作区： path` | Remove space: `${T('workspace')}${path}` |
| Mixed separators | `·` and `:` and `=` in same output | Pick one per semantic role |
| Diagnostic no separator | `${T(d.level)}${d.message}` → `错误Some msg` | Use `${T(d.level)}: ${d.message}` (T('error') has NO colon) |
| Path separator mismatch | `activeTarget.project === pro` fails `\` vs `/` | Normalize both: `normalizePath(a) === normalizePath(b)` |
| Check names not translated | `c.name` shows `target` in Chinese | Use name map: `checkNameMap[c.name] \|\| c.name` |

## nextActions UX

When generating nextActions suggestions:
- **Optional params should look optional**: Don't show `--remote-path <path>` if it's not required. Only include it in error hints when the value is actually missing.
- **Use user-friendly placeholders**: `--server <name>` not `--server <id>` (users know names, not UUIDs)
- **Fill in actual values when possible**: Instead of `--server <name>`, read the server list and show real names
- **Threshold-based display for multiple options**:
  - 0 items → show the "add/create" command
  - 1 item → auto-fill: `forja use remote --server actual_name`
  - 2-5 items → pipe-separated: `forja use remote --server <name1|name2|name3>`
  - 6+ items → show `forja list servers` + generic `forja use remote --server <name>`
- **Never list every option as a separate line** — it clutters the output when there are many options

## Key Principles

- **T() is the single source of labels**: Never hardcode user-visible strings
- **One separator per semantic role**: `=` for state, `→` for direction, `·` for grouping
- **Audit all formatters together**: Changing one without others creates inconsistency
- **Test both locales**: Always verify output in both `zh` and `en`
