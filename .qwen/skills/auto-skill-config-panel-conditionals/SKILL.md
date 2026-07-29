---
name: config-panel-conditionals
description: Config panel HTML uses <!--IF_QT-->/<!--IF_WIN--> conditional blocks for module-specific UI sections — never show irrelevant settings
source: auto-skill
extracted_at: '2026-06-25T10:04:46.248Z'
---

# Config Panel Conditional UI Blocks

The config panel (`configPanel.html`) uses server-side conditional blocks to show/hide sections based on active module or platform.

## Syntax

```html
<!--IF_QT-->
  <div class="field">... Qt-only content ...</div>
<!--END_QT-->

<!--IF_WIN-->
  <div class="field">... Windows-only content ...</div>
<!--END_WIN-->
```

## Processing

In `template.ts` `getHtml()`, conditional blocks are processed BEFORE variable substitution:

```typescript
// Remove or keep blocks based on conditions
if (!data.qtActive) {
    html = html.replace(/<!--IF_QT-->[\s\S]*?<!--END_QT-->/g, '');
} else {
    html = html.replace(/<!--IF_QT-->/g, '').replace(/<!--END_QT-->/g, '');
}
```

## Available Conditions

| Block | Condition | Data field |
|-------|-----------|------------|
| `<!--IF_WIN-->` | `data.isWin` | Platform is Windows |
| `<!--IF_QT-->` | `data.qtActive` | Qt workspace root is configured |

## When to Use

- **Module-specific settings**: "排除目录" only applies to Qt's directory scanning, not SDK's vcxproj parsing → wrap in `<!--IF_QT-->`
- **Platform-specific settings**: Windows-only fields (architecture, VS path) → wrap in `<!--IF_WIN-->`
- **Never show irrelevant settings**: If a setting has no effect for the current module/platform, hide it entirely — don't show it disabled or grayed out

## Adding New Conditions

To add a new conditional block type (e.g., `<!--IF_SDK-->`):

1. Add the condition check in `template.ts` `getHtml()`, following the same pattern
2. Add the corresponding boolean to `TemplateData` interface
3. Ensure `index.ts` populates the field when constructing `TemplateData`

## Rules

1. **Conditional blocks are server-side** — processed in `getHtml()` before sending to webview. Not CSS `display:none`.
2. **Block markers are stripped** — after processing, only the content remains (or nothing if condition is false).
3. **Both start and end markers must be present** — `<!--IF_XXX-->` and `<!--END_XXX-->`. Missing end marker causes regex to consume rest of file.
4. **Nesting is NOT supported** — the regex is non-greedy but doesn't handle nested blocks of the same type.
5. **The dynamic page template** (`pages/project.ts`) uses TypeScript `if (data.qtActive)` instead of HTML comments — same logic, different syntax.

## Two Rendering Systems

The config panel has TWO rendering paths:

1. **Old sidebar** (`configPanel.html` + `template.ts`): Uses `<!--IF_QT-->` HTML comments. Rendered by `getHtml()` in `template.ts`.
2. **New tabbed pages** (`pages/project.ts` + `pageTemplate.ts`): Uses TypeScript `if (data.qtActive)` checks. Rendered by `getPageHtml()` in `pageTemplate.ts`.

Both are active — the sidebar uses `configPanel.html`, and the tabbed editor panels use `pages/*.ts`. Changes to conditional UI must be made in **both** systems.

### SDK Section in pages/project.ts

The `pages/project.ts` has a `buildSdkSection(data)` function (called at line 28 via `h += buildSdkSection(data)`) that renders the SDK project section. This is separate from the Qt section. Both sections have their own "生成 IntelliSense 配置" button. Do NOT add a duplicate inline SDK section — use the existing `buildSdkSection` function.
