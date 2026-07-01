# `forja doctor`

[← 返回总览](index.md)

**职责**：深度诊断和恢复。比 `status` 慢，负责检查工具链、sync、SSH、远端 Forja、workspace。所有“能不能用”和“如何恢复”的问题归 doctor。

**公开语法**：
```
forja doctor [--remote] [--server <id>] [--workspace <path>] [--json]
forja doctor fix [--remote] [--server <id>] [--plan] [--workspace <path>] [--json]
forja doctor unlock <lock-id> [--force] [--workspace <path>] [--json]
```

**隐藏语法**（破坏性操作，不进入主帮助）：
```
forja doctor restore <repo> <paths...> [--force] [--workspace <path>] [--json]
forja doctor reset <repo> <paths...> [--force] [--workspace <path>] [--json]
forja doctor clean-untracked <repo> <paths...> [--recursive] [--force] [--workspace <path>] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 当前状态摘要 | `forja status` |
| 有哪些配置/候选项 | `forja list` |
| 工具链、SSH、远端 Forja 是否可用 | `forja doctor` / `forja doctor --remote` |
| 非破坏性修复 | `forja doctor fix` |
| 预览非破坏性修复 | `forja doctor fix --plan` |
| 部署远端 Forja bin | `forja doctor fix --remote` |
| 解除远端 lock | `forja doctor unlock <lock-id>` |
| git restore/reset/clean-untracked | 隐藏 doctor 子动作，必须显式传入 |

## 标准检查项

| Check | 范围 | 说明 |
|-------|------|------|
| `target` | local | active target 存在、kind/mode/arch 合法、项目文件存在 |
| `toolchain-qt` | local/remote | Qt/qmake 可用性 |
| `toolchain-vs` | local/remote Windows | Visual Studio/MSBuild 或 vcvars 可用性 |
| `toolchain-jom` | local/remote Windows | jom 可用性，warning 级别 |
| `toolchain-make` | local/remote POSIX | make 可用性 |
| `sync` | local | server/path 配置完整性 |
| `remote` | remote | SSH、远端 Forja bin、版本、workspace、lock |
| `cleanup` | local | 已删除/移动项目的残留配置，仅 `fix` 修改 |

## 行为

1. `doctor` 默认检查 active target、本地工具链和 sync 配置。
2. activeTarget.runAt=remote 或传 `--remote` 时，追加远程检查。
3. `--remote --server <id>` 临时指定要检查或修复的共享 server，不修改 remote/sync 配置。
4. `fix` 只允许非破坏性修复：cleanup 残留配置、初始化本地状态目录、部署/更新远端 Forja bin。
5. `fix --plan` 只输出将修复/写入/上传的内容，不修改配置、不上传文件。
6. `unlock` 只释放指定 lock；无 `--force` 时必须校验 lock owner/stage 可安全释放。
7. `restore`/`reset`/`clean-untracked` 是破坏性操作，不在 `doctor` 或 `fix` 中自动执行；`--force` 只跳过安全确认，不扩大路径范围。
8. doctor 不负责选择目标，不写 active target；需要用户选择时指向 `forja list` + `forja use target --project <path>`。
9. 文本输出可包含详细建议；JSON 只输出稳定 code、check status 和 nextAction。
10. 旧 `remote test/doctor --bootstrap` 的“检查失败时部署/更新远端 Forja bin”组合语义归 `doctor fix --remote`；普通 `doctor --remote` 只检查，不上传。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja sync test-connection` | `forja doctor --remote [--server <id>]` |
| `forja remote test` | `forja doctor --remote` |
| `forja remote test --bootstrap` | `forja doctor fix --remote [--server <id>]` |
| `forja remote doctor` | `forja doctor --remote` |
| `forja remote doctor --bootstrap` | `forja doctor fix --remote [--server <id>]` |
| `forja remote bootstrap` | `forja doctor fix --remote [--server <id>]` |
| `forja remote unlock` | `forja doctor unlock <lock-id>` |
| `forja remote qt restore` | `forja doctor restore <repo> <paths...>`（隐藏） |
| `forja remote qt reset` | `forja doctor reset <repo> <paths...>`（隐藏） |
| `forja remote qt clean-untracked` | `forja doctor clean-untracked <repo> <paths...>`（隐藏） |
| `forja remote sdk restore` | `forja doctor restore <repo> <paths...>`（隐藏） |
| `forja remote sdk reset` | `forja doctor reset <repo> <paths...>`（隐藏） |
| `forja remote sdk clean-untracked` | `forja doctor clean-untracked <repo> <paths...>`（隐藏） |
| `forja cleanup` | `forja doctor fix` |
| `forja cleanup --plan` | `forja doctor fix --plan` |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.remote.doctor` | `forja.doctor` | 远程诊断 |
| `forja.remote.test` | `forja.doctor` | 连接测试归 doctor |
| `forja.remote.bootstrap` | `forja.doctor` | fix --remote |
| `forja.syncTestConnection` | `forja.doctor` | 连接测试归 doctor |

## Result

```ts
interface DoctorResult extends ForjaJsonResult {
    action: 'doctor';
    doctorAction: 'check' | 'fix' | 'unlock' | 'restore' | 'reset' | 'clean-untracked';
    checks?: CheckResult[];
    plan?: CommandPlan;
    changed?: string[];
}

interface CheckResult {
    name: string;
    status: 'ready' | 'blocked' | 'warning' | 'skipped' | 'unknown';
    message?: string;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}
```

## 诊断码

| code | level | 触发条件 | nextAction |
|------|-------|----------|-------------|
| `doctor.targetNotSelected` | warning | 没有 active target | `forja list`, `forja use target --project <path>` |
| `doctor.targetMissing` | error | active target 项目文件不存在 | `forja list`, `forja use target --project <path>` |
| `doctor.qtMissing` | error | qmake/Qt 不可用 | `forja list env`, `forja use qt --qt-path <path>` |
| `doctor.vsMissing` | error | VS/MSBuild/vcvars 不可用 | `forja list env` |
| `doctor.jomMissing` | warning | jom 不可用 | `forja list env` |
| `doctor.makeMissing` | error | make 不可用 | `forja list env` |
| `doctor.syncNotConfigured` | warning | sync server/path 缺失 | `forja list servers`, `forja use sync --server <id> --remote-path <path>` |
| `doctor.remoteNoServer` | error | remote 检查缺 server/path | `forja list remote`, `forja use remote --server <id> --remote-path <path>` |
| `doctor.serverNotFound` | error | `--server` 指向不存在 server | `forja list servers` |
| `doctor.remoteSshFailed` | error | SSH 失败 | `forja list servers` |
| `doctor.remoteForjaMissing` | error | 远端 Forja bin 不存在 | `forja doctor fix --remote` |
| `doctor.remoteForjaIncompatible` | error | 远端版本不兼容 | `forja doctor fix --remote` |
| `doctor.remoteLocked` | warning | 远端 lock 存在 | `forja doctor unlock <lock-id>` |
| `doctor.cleanupFound` | warning | 发现残留配置 | `forja doctor fix` |
| `doctor.fixFailed` | error | fix 执行失败 | 视具体 check 而定 |
| `doctor.destructiveActionRequired` | warning | 需要 restore/reset/clean-untracked | 显式隐藏子动作 |

## 正常场景

```json
{
    "ok": true,
    "action": "doctor",
    "doctorAction": "check",
    "checks": [
        { "name": "target", "status": "ready" },
        { "name": "toolchain-qt", "status": "ready" },
        { "name": "toolchain-vs", "status": "ready" },
        { "name": "sync", "status": "warning", "nextAction": "forja use sync --server <id> --remote-path <path>" }
    ],
    "nextAction": "forja status"
}
```

```json
{
    "ok": true,
    "action": "doctor",
    "doctorAction": "fix",
    "changed": ["cleanup.staleProjectSettings", "remote.forjaBin"],
    "checks": [
        { "name": "cleanup", "status": "ready" },
        { "name": "remote", "status": "ready" }
    ],
    "nextAction": "forja status"
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "doctor",
    "doctorAction": "check",
    "checks": [
        {
            "name": "remote",
            "status": "blocked",
            "diagnostics": [
                { "code": "doctor.remoteForjaMissing", "level": "error", "message": "Remote Forja bin not installed" }
            ],
            "nextAction": "forja doctor fix --remote"
        }
    ],
    "nextAction": "forja doctor fix --remote"
}
```

```json
{
    "ok": false,
    "action": "doctor",
    "doctorAction": "unlock",
    "diagnostics": [
        { "code": "doctor.remoteLocked", "level": "warning", "message": "Remote lock does not match the requested lock id" }
    ],
    "nextAction": "forja doctor --remote"
}
```

## 文本输出

```
Forja doctor
Target: qt app/app.pro release x64 remote
Checks:
  target: ready
  toolchain-qt: ready
  toolchain-vs: ready
  sync: ready
  remote: blocked
Error: Remote Forja bin not installed
Next:
  forja doctor fix --remote
```

```
Forja doctor fix succeeded
Changed:
  cleanup.staleProjectSettings
  remote.forjaBin
Next:
  forja status
```

## `ok` 判定规则

- 任一 check 为 `blocked` 或 `unknown` 且影响当前目标可用性时，`ok: false`。
- 只有 warning（如 jom 缺失、sync 未配置但当前不需要 sync）时，`ok: true`。
- `fix` 中任何写入/部署失败，`ok: false`。
- `unlock` 成功释放 lock，`ok: true`；lock id 不匹配且无 `--force`，`ok: false`。

## 验证点

- `forja doctor --json` 不做远程检查，除非 activeTarget.runAt=remote。
- `forja doctor --remote --json` 检查 SSH、远端 Forja、workspace 和 lock。
- `forja doctor --remote --server <id> --json` 临时检查指定共享 server，不修改配置。
- `forja doctor fix --remote --server <id> --json` 临时向指定共享 server 部署/更新 Forja bin，不修改配置。
- `forja doctor fix --remote --json` 覆盖旧 `remote test/doctor --bootstrap` 的检查 + bootstrap 语义。
- `forja doctor fix --json` 可执行 cleanup，但不执行 restore/reset/clean-untracked。
- `forja doctor fix --plan --json` 预览 cleanup/remote fix，不写配置、不上传文件。
- `forja doctor unlock <id> --json` 只释放指定 lock。
- `forja doctor restore/reset/clean-untracked ... --force --json` 覆盖旧 remote 破坏性恢复动作的 force 语义。
- 隐藏破坏性子动作不出现在主帮助、nextAction 和 Command Palette。
