# Token Efficiency

## Goal

在不降低结论质量的前提下，控制 agent 的上下文和命令输出体积，避免流程本身造成高 token 消耗。

## Default Rules

1. 搜索默认限制范围，并排除构建产物目录：
   - `target/**`
   - `node_modules/**`
   - `dist/**`
2. 优先对目标路径执行命令，不做全仓扫描。
3. `git status` 默认带路径参数，只看本次任务相关文件。
4. 文件读取采用“定位 + 窗口”模式：
   - 先 `rg -n` 定位行号
   - 再 `sed -n 'start,endp'` 读取片段
5. 长输出先截断再决策：
   - `head -n`
   - `tail -n`
6. 避免重复读取同一大文件；如需复查，优先复用已有定位结果。
7. gate 输出保持紧凑标签行，不重复历史结论和模板原文。
8. 自动化检查默认跑“当前变更集”，不要把历史存量作为日常默认扫描对象。
9. 命令输出只保留决策所需摘要；若问题很多，先输出数量、规则名和前几个位置。

## Automation Cost Budget

自动化按成本分层执行，默认从低成本开始：

| Level      | 默认用途                 | 命令示例                                                                              | Token 策略                            |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `light`    | 日常开发、agent 每轮收口 | `node harness/process/automation/check-process.js --changed --summary --max-issues 3` | 只扫当前变更的流程文档                |
| `targeted` | 具体模块验证             | `node harness/process/automation/check-process.js --summary --max-issues 3 <path>`    | 只传相关文件或目录，不扩到全仓        |
| `full`     | 阶段收口、CI、迁移完成前 | `npm run lint` / 全量测试                                                             | 只在 Verification gate 说明原因后运行 |

默认选择：

1. 本轮只改流程文档或 harness core：先跑 `node harness/process/automation/check-process.js --changed --summary --max-issues 3`
2. 本轮新增入口、路由、页面、命令或导出：跑项目 adapter 提供的入口检查，或用 `node harness/process/automation/check-process.js --summary --max-issues 3 <path>` 检查相关流程文件
3. 准备阶段收口或高风险入口改动：再追加 lint / 单测 / 构建

不要为了“更保险”默认跑全量测试；只有当当前结论依赖全量结果时才跑。

## Output Budget

- 运行检查时，默认只在最终回复写命令和结果，不粘贴完整 stdout。
- 检查失败时，最多列 3-5 个代表性问题；其余用数量汇总。
- 需要完整定位信息时，优先读取检查生成的 `.tmp/harness-check-report.json`，不要把完整问题列表粘进对话。
- 长输出需要继续分析时，先保存或定位，再读取相关窗口。
- 若某个检查会扫描 50 个以上文件，优先说明扫描范围和为什么必要。

## Command Patterns

- 搜索：
  - `rg -n "pattern" <target-dir> --glob '!target/**' --glob '!node_modules/**' --glob '!dist/**'`
- 文件列表：
  - `rg --files <target-dir> --glob '!target/**' --glob '!node_modules/**' --glob '!dist/**'`
- 状态：
  - `git status --short -- <path-a> <path-b>`

## Verification Expectation

- 验证命令同样遵守最小范围原则，只跑当前改动相关检查。
- 若必须运行大范围检查，需要在 Verification gate 说明原因和范围。
- 不能把 harness 流程检查的通过描述成业务测试通过；它只证明流程文档和已接入的项目检查通过。
