# CLI 输出改进 — 问题清单

> 分析时间: 2026-05-15

## 一、nextActions 不区分参数来源（高优先级）

### 问题描述

当命令失败或需要恢复操作时，`nextActions` 给出的提示是固定文本，不区分当前 mode/arch/qtPath/vsDevShell 是从 CLI 参数传入还是从 settings 读取。

### 影响场景

| 场景 | 当前 nextActions | 问题 |
|------|-----------------|------|
| `run --mode release --arch x64` 但 Makefile 是 debug/x86 | `'先执行 qmake 生成 Makefile，再重新调用 run'` | 不带 `--mode release --arch x64`，agent 可能用默认值 qmake |
| qtPath 缺失，CLI 没传也没配 | `'使用 --qt-path 或先 init --execute'` | 正确 |
| qtPath 缺失，CLI 传了无效路径 | 不触发 warning（非空就不报） | 应该提示路径无效 |
| vsDevShell 同上 | 同上 | 同上 |

### 涉及代码

- `src/qt/shared/qtCore.ts` — `buildEnvironmentGuidance()` 函数
- `src/qt/shared/qtCore.ts` — run action Makefile 不匹配分支（line ~341）
- `src/qt/shared/qtCore.ts` — 通用 return（line ~396）

### 改进方案

- `buildEnvironmentGuidance` 增加 `options` 参数，判断 qtPath/vsDevShell 是 CLI 传入还是缺失
- run 的 qmake 提示根据 `options.mode !== null` 决定是否带参数
- 新增 `buildQmakeHint(options, mode, arch)` 辅助函数

---

## 二、项目解析失败时 resolved 为 null（中优先级）

### 问题描述

当 `resolveProject` 报错提前返回时，`result` 基于 `emptyResult`，`resolved: null`。agent 拿到 `ok: false` 的响应时看不到当前使用的 mode/arch 是什么。

### 影响

- agent 想重试时不知道当前 resolved 的配置值
- JSON 和 brief 模式都没有 resolved 字段

### 涉及代码

- `src/qt/shared/qtCore.ts` — project error 分支（line ~208-220）

### 改进方案

在 project error 分支也填充 `resolved`（此时 mode/arch/qtPath/vsDevShell 已经可以计算）。

---

## 三、VS 版本和 Qt 版本信息丢失（中优先级）

### 问题描述

`detectEnv()` 检测到了完整的版本信息（VS version/edition、Qt version/compiler），但在存储和输出环节被丢弃。

### 信息流断点

```
detectEnv() → { vs: { version, edition, installPath, devShellPath }, qt: { version, compiler, path } }
     ↓
detectAndCache() → LocalCache 只存 { path, qmake } 和 { devShellPath }  ← 版本丢失
     ↓
CliResolvedConfig → 只有 qtPath, vsDevShell  ← 无版本字段
     ↓
JSON 输出 → resolved: { mode, arch, qtPath, vsDevShell, qmakeTarget }  ← 用户/agent 只能从路径猜版本
```

### 影响

- agent 无法确认实际使用的 Qt/VS 版本
- 路径不含版本号时（如 `/usr/local/qt`）完全无法判断
- status 命令调用了 detectEnv 但只取了 path

### 改进方案

1. `LocalCache.detected.qt` 增加 `version` 和 `compiler` 字段
2. `LocalCache.detected.vs` 增加 `version` 和 `edition` 字段
3. `CliResolvedConfig` 增加 `qtVersion?` 和 `vsVersion?` 可选字段
4. `status` 和正常流程中填充版本信息

---

## 四、brief + detach 成功时不返回 resolved（低优先级）

### 问题描述

`compactResult` 在 brief 模式下，detach 成功后直接 return，不包含 `resolved` 和 `project`。

```typescript
const isDetachSuccess = result.ok && result.logFile && result.exitCode === 0
    && ['run', 'build', 'clean'].includes(result.action);
if (isDetachSuccess) { return out; }
```

### 影响

- agent 后续需要知道用了什么 mode/arch（比如 stop 后重新 run）时拿不到
- 设计意图是减少 token，可接受

---

## 五、qtPath/vsDevShell 路径有效性不校验（低优先级）

### 问题描述

`buildEnvironmentGuidance` 只检查最终 resolved 值是否为空字符串。如果 CLI 传了 `--qt-path C:/wrong/path`，resolved 值非空，不触发 warning——即使路径不存在。

### 影响

- 用户传了错误路径不会得到提示
- 执行阶段才会因为找不到 qmake 而失败，报错信息不够直接

### 改进方案

在 `buildEnvironmentGuidance` 中对非空的 qtPath/vsDevShell 做 `fs.existsSync` 检查，无效时给出不同的 warning。

---

## 六、textOutput 中"模式"字段语义混淆（低优先级）

### 问题描述

```typescript
`模式: ${result.mode}`  // 这里是 executionMode (dryRun/execute)，不是 buildMode (debug/release)
```

后面 `resolved` 部分有 `构建配置: debug / x86`，信息完整但命名容易误解。

---

## 七、测试覆盖缺失

### 已有测试（6 个）

- build settings fallback
- 多项目报错
- status 基本
- qmake 环境警告
- clean 命令
- init dry-run

### 缺失的关键场景

| 场景 | 优先级 |
|------|--------|
| run 无 Makefile（Branch C fallback + nextActions） | 高 |
| run 有 Makefile（正常路径命令生成） | 高 |
| CLI 参数覆盖 settings 的优先级验证 | 高 |
| nextActions 区分参数来源（改进后） | 高 |
| workspace 不存在 | 中 |
| 单个候选项目的提示文本 | 中 |
| 无 .pro 文件的提示文本 | 中 |
| project 在 workspace 外的报错 | 中 |
| env var fallback (FORJA_QT_PATH / FORJA_VS_DEV_SHELL) | 低 |
| stop/rcc action | 低 |

---

## 八、nextActions 中残留已废弃的 --execute 参数

### 问题描述

`--execute` 已是默认行为（兼容旧版空操作），但 nextActions 提示中仍在使用 `init --execute`：

- `'先运行 init --execute 保存本地配置'`
- `'确认无误后运行 init --execute --json 写入本地配置'`
- `'先运行 init --execute 保存默认项目'`

### 改进

去掉所有 `--execute`，直接说 `init` 或 `init --json`。

### 涉及代码

- `src/qt/shared/qtCore.ts` — 5 处 `init --execute` 文本

---

## 执行优先级

1. **第一批（本次）：** 问题一 + 问题二 + 问题八 + 测试补全（高优先级场景）
2. **第二批：** 问题三（版本信息）
3. **第三批：** 问题五（路径校验）+ 其余测试
4. **可选：** 问题四、问题六
