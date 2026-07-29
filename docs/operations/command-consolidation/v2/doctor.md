# `forja doctor`

[← 返回总览](index.md)

**职责**：深度诊断和恢复。检查工具链路径有效性、SSH 连接、sync 配置完整性，并提供修复动作。比 `status` 更深入——status 只读配置判断就绪度，doctor 做实际验证（路径存在性、SSH 连接）。

**语法**：
```
forja doctor [check|fix|unlock] [--remote] [--server <id>] [--json]
```

**前置条件**：无。workroot 未注册时仍可做基础诊断。

## 子动作

| 动作 | 说明 |
|------|------|
| `doctor`（默认） | 运行所有检查 |
| `doctor check` | 同默认 |
| `doctor fix` | 清理过期配置 + 部署远端 forja-bin |
| `doctor unlock` | 释放远程 lock |

## 检查项

### 本地检查

| 检查 | 说明 |
|------|------|
| target | active target 的项目文件是否存在 |
| toolchain-qt | Qt 路径是否有效（从 active target 的 toolchain 读取） |
| toolchain-vs | VS 路径是否有效 |
| toolchain-jom | jom 路径是否有效（Windows） |
| toolchain-make | make 是否可用（POSIX） |
| sync | sync server 和 remote path 是否配置完整 |
| remote | 远程 forja-bin 是否存在 |

### 远程检查（`--remote`）

通过 SSH bridge 在远端执行诊断。`--server <id>` 临时指定服务器。

## 数据源

| 数据 | 来源 |
|------|------|
| 工具链路径 | active target 的 toolchain 字段（workspaceStore） |
| sync 配置 | settingsIO（`loadSyncSettings`） |
| remote 配置 | settingsIO（`loadRemoteSettings`） |

## Result

```ts
interface DoctorResult extends ForjaJsonResult {
    action: 'doctor';
    checks: CheckResult[];
    plan?: CommandPlan;
}

interface CheckResult {
    name: string;
    status: 'ready' | 'blocked' | 'warning' | 'skipped' | 'unknown';
    message?: string;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}
```

## nextAction 规则

| 条件 | nextAction |
|------|-----------|
| 有 blocked 检查 | `forja doctor fix` |
| 全部通过 | `forja status` |

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja status` | 轻量版（doctor 做深度验证） |
| `forja build` | doctor 修复后的下一步 |
| `forja list env` | 查看工具链路径（doctor 验证路径有效性） |

## 验证点

- `forja doctor --json` 检查工具链路径有效性（从 workspaceStore 读取）
- `forja doctor --remote --json` 通过 SSH 做远端诊断
- `forja doctor fix --json` 清理过期配置
- 工具链路径无效时 status 为 `blocked`
