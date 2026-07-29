# Git Gate

## Goal

约束 agent 在完成开发任务后提交代码的最小规范，避免糟糕的提交质量、夹带无关改动或泄露敏感信息。

这个阶段关注的是"代码如何进入版本控制"，而不是代码本身的质量（那是 implementation gate 和 verification gate 的事）。

## When To Use

只有用户明确要求提交、创建分支或准备 PR 时才进入 Git gate。普通代码修改完成后，只需要在 Delivery gate 说明改动范围和验证结果。

## Must Check

### 提交前自查

- 相关 lint/test 是否通过（或有明确的未执行原因）
- `git diff --stat` 确认改动范围，是否夹带无关文件
- 是否有临时文件、日志文件、本地配置文件混入
- 是否有 `.env`、`credentials`、`*.pem` 等敏感文件

### 提交信息规范

- 格式：`<type>: <message>`
  - `feat`: 新功能
  - `fix`: Bug 修复
  - `refactor`: 重构（不改外部行为）
  - `docs`: 文档更新
  - `chore`: 构建/工具链配置
  - `style`: 代码格式调整（不影响逻辑）
  - `perf`: 性能优化
  - `test`: 测试新增或修改
- message 必须是有意义的描述，不要只写 `fix: bug` 或 `update: files`
- 如果改动较复杂，提交 body 应补充说明：
  - 为什么做这个改动
  - 影响了哪些模块
  - 是否有破坏性变更

### 提交粒度

- 多个无关改动必须拆分多次提交，不要混成一个
- 代码格式调整和逻辑修改必须分开提交
- 重构和功能新增必须分开提交
- 文档更新和业务逻辑修改建议分开提交

### 不提交的内容

- `.env`、`credentials`、`*.pem`、`*.key`
- `node_modules/`
- `*.log`、日志目录
- IDE 配置文件（`.idea/`、`.vscode/` 除非团队约定共享）
- 临时文件、调试输出
- 应用运行日志目录
- 数据库或本地持久化数据文件
- 构建产物（除非明确要求提交 dist）

### 分支规范

- 分支命名：`feature/<name>`、`fix/<name>`、`refactor/<name>`
- 分支名使用 kebab-case，不用下划线或驼峰
- 分支名应反映任务内容，如 `feature/host-search`、`fix/deploy-timeout`
- 不要直接在 master/main 上提交

## Workflow

### 标准流程

```bash
# 1. 确认改动范围
git status
git diff --stat

# 2. 自查（按任务选择最小相关命令）
npm run lint

# 3. 提交（用户执行或 agent 根据指示执行）
git add <files>
git commit -m "<type>: <message>"

# 4. 确认提交干净
git status
git log -1
```

### 多改动拆分

```bash
# 先提交逻辑修改
git add <route-files> <service-files>
git commit -m "feat: add host search API"

# 再提交格式调整（如需要）
git add <component-files>
git commit -m "style: format search components"
```

## Commit Examples

### Good

```
feat: add host search with fuzzy matching

- Add POST /api/hosts/search endpoint
- Add BaseSelect searchable mode
- Add hostsStore.searchHosts() composable
```

```
fix: resolve deploy timeout on large projects

Deploy task was timing out due to missing keep-alive header
in SSE response. Added explicit Transfer-Encoding: chunked.
```

```
refactor: extract branch conflict handling to composable

No behavior change. Extracted conflict detection and
resolution logic from BranchView.vue to useBranchConflict.js.
```

### Bad

```
fix: bug
update: files
fix deploy issue
feat add search
```

## Gate Pass Criteria

以下全部满足后，才可视为通过 Git Gate：

- [ ] 没有提交敏感文件或无关文件
- [ ] 提交信息格式正确且有意义
- [ ] 提交粒度合理（无关改动已拆分）
- [ ] 工作目录干净（`git status` 无意外未跟踪文件）
- [ ] 分支命名符合规范（如已创建新分支）

## Recommended Output

```text
Git gate
- 范围：...
- 检查：...
- 提交信息：...
- 排除：...
```
