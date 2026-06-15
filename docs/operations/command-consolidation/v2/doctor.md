# `forja doctor`

[← 返回总览](index.md)

**职责**：深度诊断和恢复。比 `status` 慢，负责检查工具链、sync、SSH、远端 Forja、workspace。所有"能不能用"的问题归 doctor。

**公开语法**：
```
forja doctor [--remote] [--workspace <path>] [--json]
forja doctor fix [--remote] [--workspace <path>] [--json]
forja doctor unlock <lock-id> [--force] [--workspace <path>] [--json]
```

**隐藏语法**（破坏性操作，不进入主帮助）：
```
forja doctor restore <repo> <paths...> [--workspace <path>] [--json]
forja doctor reset <repo> <paths...> [--workspace <path>] [--json]
forja doctor clean-untracked <repo> <paths...> [--recursive] [--workspace <path>] [--json]
```

**标准检查项**：
- `toolchain-qt` — Qt 安装检测（qmake 可用性）
- `toolchain-vs` — Visual Studio 检测（MSBuild 可用性）
- `toolchain-jom` — jom 检测（并行构建工具）
- `toolchain-make` — make 检测
- `target` — active target 有效性
- `sync` — sync 配置完整度
- `remote` — SSH 连接、远端 Forja bin、workspace（仅 `runAt=remote` 或 `--remote` 时）

**行为**：
1. 检查 active target。
2. 检查本地工具链（Qt/VS/jom/make）。
3. 检查 sync 配置。
4. `runAt=remote` 或 `--remote` 时检查远程。
5. `fix` 只允许非破坏性修复（含 cleanup 残留配置、bootstrap 远端 Forja bin、初始化本地状态目录）。
6. `unlock` 解远程锁，`--force` 强制。
7. `restore`/`reset`/`clean-untracked` 是破坏性操作，必须显式传入，不在 `doctor` 或 `fix` 中自动执行。

**吸收的旧命令**：
`forja sync test-connection`、`forja remote test`、`forja remote doctor`、`forja remote bootstrap`（→ `doctor fix --remote`）、`forja remote unlock`、`forja remote qt restore/reset/clean-untracked`、`forja remote sdk restore/reset/clean-untracked`、`forja cleanup`（→ `doctor fix`）

**Result**：
```ts
interface DoctorResult extends ForjaJsonResult {
    action: 'doctor';
    doctorAction: 'check' | 'fix' | 'unlock' | 'restore' | 'reset' | 'clean-untracked';
    checks?: CheckResult[];
    changed?: string[];
}

interface CheckResult {
    name: string;
    status: 'ready' | 'blocked' | 'warning' | 'skipped' | 'unknown';
    message?: string;
    diagnostics?: Diagnostic[];
    nextActions?: string[];
}
```
