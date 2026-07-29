---
name: no-redundant-output-sections
description: CLI output must not repeat the same information in multiple sections — if a readiness/summary section covers a topic, don't add a separate section for it
source: auto-skill
extracted_at: '2026-07-06T02:32:51.910Z'
---

# No Redundant Output Sections

CLI command output must not repeat the same information in multiple sections. If a readiness/summary section already covers a topic (e.g., "运行时: 未选择"), don't add a separate detailed section that says the same thing (e.g., "运行时: 未运行").

## Anti-Pattern: Same Info in Two Places

```
就绪度：
  ✓ 目标:  就绪
  ✓ 工具链:  就绪
  - 运行时:  未选择      ← already tells user runtime status

运行时：  未运行          ← redundant!
```

## Correct Pattern: Detail Section Only When There's Detail to Show

```
就绪度：
  ✓ 目标:  就绪
  ✓ 工具链:  就绪
  - 运行时:  未选择      ← covers the not-running case

                          ← no separate runtime section when not running
```

When the process IS running, show the detail section (it adds new info: PID, executable path, log file):

```
就绪度：
  ✓ 目标:  就绪
  ✓ 工具链:  就绪
  ✓ 运行时:  就绪

运行时：  运行中 (PID 12345)
  可执行文件  C:\path\to\app.exe
  日志  C:\path\to\log.txt
```

## Rules

1. **Readiness/summary covers the default case** — if a field shows "未选择"/"未运行"/"N/A" in the summary, don't repeat it as a separate section
2. **Detail section only when there's detail** — only show a separate section when it adds NEW information (PID, paths, sub-status) not already in the summary
3. **One piece of information, one place** — each fact should appear exactly once in the output

## Audit Checklist

- [ ] Does every output section add unique information?
- [ ] Are "not running"/"not selected"/"N/A" states covered by the summary without a separate section?
- [ ] Are detail sections only shown when there's actual detail to display?
