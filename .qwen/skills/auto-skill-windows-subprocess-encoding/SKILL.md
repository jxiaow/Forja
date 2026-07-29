---
name: windows-subprocess-encoding
description: Windows subprocess output must decode as UTF-8 first (fatal:true), then fall back to GBK — never assume one encoding for all tools
source: auto-skill
extracted_at: '2026-07-06T04:10:17.176Z'
---

# Windows Subprocess Output Encoding

On Windows, child processes may output in different encodings depending on the tool:
- **Modern tools** (MSBuild, cmake, newer VS): UTF-8
- **Legacy tools** (cmd builtins, older jom/nmake): GBK (system code page)

The decoder must try UTF-8 first, then fall back to GBK.

## Bug Pattern: GBK-Only Decoder

```typescript
// BUG: GBK with fatal:false always "succeeds" — UTF-8 output gets garbled
function decodeWinOutput(buffer: Buffer): string {
    return new TextDecoder('gbk', { fatal: false }).decode(buffer);
}
```

`TextDecoder('gbk', { fatal: false })` never throws — it silently replaces invalid byte sequences. So UTF-8 output from MSBuild gets decoded as GBK, producing garbled characters like `閫傜敤浜` instead of `适用于`.

## Correct Pattern: UTF-8 First, GBK Fallback

```typescript
function decodeWinOutput(buffer: Buffer): string {
    try {
        // Modern tools output UTF-8
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // Legacy tools output GBK (system code page)
        try {
            return new TextDecoder('gbk', { fatal: false }).decode(buffer);
        } catch {
            return buffer.toString('utf-8');
        }
    }
}
```

## Rules

1. **UTF-8 with `fatal: true` first** — if the buffer is valid UTF-8, use it. `fatal: true` makes it throw on invalid sequences.
2. **GBK with `fatal: false` as fallback** — only reached when UTF-8 decoding fails.
3. **Apply to both stdout and stderr** — and to both streaming and buffered execution modes.
4. **Streaming caveat** — in streaming mode, chunks may split mid-character. This is rare in practice (line-buffered output) but be aware of it.

## Also: Filter Noisy Compiler Warnings

Some warnings flood output for every source file. Filter them from both streaming and buffered output:

```typescript
const SUPPRESSED_WARNINGS = [
    /warning C4819:/,  // Unicode-in-codepage warning
];

function filterBuildOutput(text: string): string {
    return text.split('\n')
        .filter(line => !SUPPRESSED_WARNINGS.some(re => re.test(line)))
        .join('\n');
}
```

## Audit Checklist

- [ ] Does the decoder try UTF-8 with `fatal: true` before GBK?
- [ ] Is the decoder applied to both stdout and stderr?
- [ ] Is the decoder applied in both streaming and non-streaming paths?
- [ ] Are noisy warnings (C4819, etc.) filtered from output?
