---
name: spec-doc-sync
description: Keep markdown spec files and their English/Chinese HTML equivalents in sync after edits
source: auto-skill
extracted_at: '2026-06-15T11:45:00.000Z'
---

# Spec Document Sync

When specification documents exist in multiple formats (`.md` + `v2-en/*.html` + `v2-zh/*.html`), edits to the source markdown must be propagated to both HTML variants.

## When This Applies

- The spec directory contains parallel language variants (e.g., `v2/`, `v2-en/`, `v2-zh/`)
- Each command has a `.md` source file and matching `.html` files in each variant directory
- The user explicitly requests HTML sync or you just edited the `.md` source

## Process

### 1. Identify All Variants

Before editing, check which directories exist:
```
v2/          — source markdown
v2-en/       — English HTML
v2-zh/       — Chinese HTML
```

### 2. Edit Source Markdown First

- Apply all changes to the `.md` file in the source directory
- Verify the markdown changes are complete before propagating

### 3. Propagate to Each HTML Variant

For each HTML variant:

**a. Diagnostic Code Table**
- Find the `<table>` with diagnostic codes
- Add/remove rows to match the markdown
- Keep the same row order

**b. Scenario Examples**
- Convert each markdown scenario into a `<div class="tab-group">` block
- Use tab-buttons for JSON/Text toggle when both exist
- Use plain `<pre>` blocks when only JSON is available
- Match the `id` attributes for TOC linking

**c. Implementation Details / Rules Sections**
- Convert markdown lists into `<ul>/<li>` HTML
- Convert code blocks into `<pre><code class="language-*">` blocks
- Keep section `id` attributes consistent

**d. ok Determination Rules**
- Convert the markdown list into nested `<ul>` HTML
- Keep the same logical structure (local vs remote modes)

**e. Boundary Sections (e.g., "Boundary with `list`")**
- Convert markdown list into `<ul>/<li>` HTML
- Use `<h2 id="boundary">` for the section heading
- Add the boundary link to the TOC sidebar (`<aside class="toc-sidebar">`)
- Both EN and ZH HTML variants need the same boundary section (labels translated, code unchanged)

**f. Absorbed Commands Updates**
- When commands are reclassified (moved from one new command to another), update both the source and destination HTML files
- Add a `<p><strong>Note</strong>:` block in the destination if commands were moved from elsewhere
- Keep the absorbed commands list in sync with the markdown

### 4. Verify Consistency

After propagating to all variants:
- Count diagnostic codes in each variant — must match
- Count scenario examples in each variant — must match
- Verify all `id` attributes used by TOC exist in the HTML
- Check that both HTML files use the same tab button IDs (e.g., `s-idempotent-json`, `s-idempotent-text`)

### 5. Handle Language Differences

- **EN HTML**: All labels, headings, and descriptions in English
- **ZH HTML**: Headings and labels in Chinese, but code/JSON/TS remain unchanged
- Diagnostic code tables keep both EN and ZH messages in both variants (the table itself is bilingual)

## Example: Converting a Markdown Scenario

**Markdown source:**
```markdown
_重复执行（幂等）_：
```json
{ "ok": true, ... }
```

_文本输出_：
```
Forja init succeeded
...
```
```

**HTML output (tab-group with JSON + Text):**
```html
<div class="tab-group">
<h3 id="idempotent-run">重复执行（幂等）</h3>
<div class="tab-buttons">
  <button class="tab-btn active" data-tab="s-idempotent-json">JSON</button>
  <button class="tab-btn" data-tab="s-idempotent-text">Text</button>
</div>
<div class="tab-panel active" id="s-idempotent-json">
  <pre><code class="language-json">{ "ok": true, ... }</code></pre>
</div>
<div class="tab-panel" id="s-idempotent-text">
  <pre><code class="language-text">Forja init succeeded
...</code></pre>
</div>
</div>
```

## Key Principles

- **Source of truth**: The `.md` file is authoritative; HTML variants are derived
- **Parity**: All variants must have the same number of diagnostic codes, scenarios, and sections
- **Tab consistency**: Use tab-buttons for JSON/Text pairs; use plain blocks when only one format exists
- **TOC sync**: When adding new sections, update the TOC sidebar in the HTML (the `<aside class="toc-sidebar">` block)
