---
name: spec-documentation-review
description: Review and complete specification documents against a benchmark before implementation begins
source: auto-skill
extracted_at: '2026-06-15T11:29:38.248Z'
---

# Spec Documentation Review

When tasked with completing or reviewing specification documents before implementation, follow this process to ensure all specs are implementation-ready.

## Process

### 1. Read All Reference Documents First

- Read every file in the spec directory to understand the full scope
- Identify which documents exist and which are missing
- Do not skip to implementation — the user explicitly wants documentation complete first

### 2. Identify a Benchmark Document

- Find the most complete document in the set (e.g., `status.md` had syntax + behavior + diagnostic code table + JSON/text examples + ok判定规则)
- Use it as the gold standard for completeness grading

### 3. Grade Each Document Against the Benchmark

Create a completeness table:

| 级别 | 命令 | 状态 |
|------|------|------|
| **已达标** | `status` | 语法 + 行为 + 诊断码表 + JSON/文本示例 + ok 判定规则 |
| **骨架完成** | `list`、`use` | 语法 + 行为 + Result 接口，缺示例和诊断码表 |

### 4. Identify Specific Gaps Per Document

For each incomplete document, list concrete missing items:
- Missing diagnostic code table entries
- Missing JSON output examples (normal + error scenarios)
- Missing text output examples
- Missing ok判定规则
- Ambiguous edge case handling

### 5. Raise Clarifying Questions

For each gap, formulate specific questions rather than making assumptions:
- "是否需要 `init.targetKindMismatch` 诊断码？"
- "如果 workspace 有 1 个 Qt 目标 + 0 个 SDK 目标，init 自动保存 Qt，这符合预期吗？"
- "bridge 连接失败时，是否自动 fallback 到 doctor fix？"

### 6. Present Findings as Discussion, Not Decisions

- Summarize current state clearly
- List open questions grouped by topic
- Offer multiple next-step options (A/B/C) for the user to choose from
- Do not proceed to implementation until the user confirms the spec is ready

## Key Principles

- **Documentation first**: The user may explicitly want specs complete before any code changes
- **Benchmark-driven**: Use the best document in the set as the completeness standard
- **Question, don't assume**: When specs are ambiguous, raise the question rather than deciding unilaterally
- **Structured output**: Use tables and bullet lists for scannability, not prose paragraphs
