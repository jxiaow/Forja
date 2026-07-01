---
name: spec-doc-sync
description: Edit markdown spec files only — HTML variants are auto-generated and must NOT be manually edited
source: auto-skill
extracted_at: '2026-07-01T07:04:51.409Z'
---

# Spec Document Sync

When specification documents exist in multiple formats (`.md` + `v2-en/*.html` + `v2-zh/*.html`), **only edit the `.md` source files**. HTML variants are auto-generated and will be regenerated later.

## Critical Rule

**Do NOT manually edit HTML files.** The user will regenerate them uniformly. This applies to all files under `v2-en/` and `v2-zh/` directories.

## When This Applies

- The spec directory contains parallel language variants (e.g., `v2/`, `v2-en/`, `v2-zh/`)
- Each command has a `.md` source file and matching `.html` files in each variant directory
- You need to update spec documentation

## Process

### 1. Edit Source Markdown Only

- Apply all changes to the `.md` file in the source directory (`v2/` or root `docs/`)
- Verify the markdown changes are complete
- **Do NOT touch `v2-en/*.html` or `v2-zh/*.html` files**

### 2. Identify All Markdown Sources

Before editing, check which markdown files need updating:
```
v2/              — source markdown (e.g., status.md, index.md, doctor.md)
docs/            — top-level docs (e.g., cli-interface-spec.md, README-cli.md)
operations/      — operation-specific docs (e.g., command-api.zh.md)
```

### 3. Verify Consistency Across Markdown Files

After editing:
- Check if the same concept (e.g., interface field name) appears in multiple `.md` files
- Ensure all markdown references are consistent
- Count diagnostic codes, scenarios across related `.md` files if applicable

## Key Principles

- **Source of truth**: The `.md` file is authoritative; HTML variants are derived
- **HTML is generated**: Never manually edit HTML — they will be regenerated from markdown
- **Cross-file consistency**: When changing a field name or concept, audit all `.md` files that reference it
