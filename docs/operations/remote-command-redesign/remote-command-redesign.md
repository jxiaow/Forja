# 远程命令体系重构设计

## 问题

### 1. 命令太多太碎
`use remote` 下面有 12+ 个子命令，全是 set/clear 配对：
- `use remote workspace set/clear`
- `use remote repo set/remove/clear`
- `use remote forja-bin set/clear`
- `use remote build-order set/clear`
- `use remote transfer set/clear`

### 2. 概念重叠
- `use sync` 和 `use remote` 都要配 server + remote-path
- `doctor fix --remote` 和 `init --remote` 都能部署 forja
- `sync transfer` 和 `use remote transfer` 是同一个概念拆成两个地方

### 3. 没有一键初始化
用户要配 5 个命令才能开始远程开发：
```
server add → use sync → use remote → use execution --remote → doctor fix --remote
```

### 4. doctor 子命令过多
`unlock`、`restore`、`reset`、`clean-untracked` 都是低频操作，占了 4 个子命令位。

### 5. list 分类太细
`list remote` 和 `list remote-repos` 分开没必要。

---

## 设计原则

1. **`forja setup` 是主入口**：本地初始化通过 `forja setup`，远程通过 `forja setup remote`
2. **setup 幂等**：已配置的部分自动跳过，只执行缺失步骤
3. **细粒度命令保留**：`use remote` 等命令保留给脚本和高级用户，简化为 2 层
4. **本地和远程独立可选**：不是所有项目都需要远程
5. **自动检测 + 确认**：能推断的自动推断，只问不能推断的
6. **不需要的配置项不暴露**：forja-bin（固定路径）不需要用户管

---

## 最终命令体系

### 初始配置
```
forja setup                              # 本地初始化（扫描、检测、自动选择）
forja setup remote                       # 远程初始化（服务器、同步、部署、init、切换执行模式）
```

### 后续修改

**方式 1：重新运行 `forja setup` / `forja setup remote`（推荐）**

已配置的步骤自动跳过，只执行缺失步骤。

**方式 2：细粒度命令（脚本/高级用户）**
```
# 远程（2 层，不带 set/clear，无参数=查看，有参数=设置，--clear=清除）
forja use remote --server <id>                          # 切换服务器
forja use remote --remote-path <path>                   # 改远程路径
forja use remote workspace --path <path> [--mode staged|legacy]  # 改 workspace
forja use remote build-order qt:build sdk:build         # 改构建顺序
forja use remote repo --local <n> --remote <n> --role <role>  # 改 repo 映射
forja use remote transfer --server <id> --path <path>   # 改部署目标

# 同步和执行模式
forja use sync --enable/--disable
forja use execution --remote/--local

# 服务器管理
forja server add/remove/update
```

### 查看
```
forja list remote                        # 合并了 remote + remote-repos
forja server
```

### 诊断
```
forja doctor --remote                    # 远程诊断
forja doctor fix --remote                # 自动修复（部署 forja 等）
```

---

## `forja setup` 详细流程

### Phase 1: 自动检测（本地，无网络）

**本地检测**：
- `collectTargetCandidates()` 扫描 .pro/.sln
- `detectEnv()` 检测 Qt/VS/jom/make
- 读已有配置判断是否已初始化

**远程检测**：
- 读 `~/.forja/servers.json` 检查已有服务器
- 读 remote/sync settings 检查已有配置
- **不做 SSH 连接**（可能慢/超时/要密码）

### Phase 2: 显示结果 + 交互

本地 setup 完成后自动检测并显示结果。`forja setup remote` 在交互模式下显示服务器信息并确认：

```
远程配置
  服务器: wsl_dev_158_44 (xw@172.31.158.44)
  远程路径: /home/xw/workspace/dev
  是否配置远程构建环境？(Y/n)
```

- **y** → 继续远程配置
- **n** → 跳过远程

如果没有服务器，提示先添加：
```
Next:
  forja server add
```

如果有多个服务器，提示选择：
```
Next:
  forja server
```

### Phase 3: 执行

```
Step 1/6: 保存本地配置...  ✓
Step 2/6: 配置远程服务器...  ✓ (wsl_dev_158_44)
Step 3/6: 启用同步...  ✓ (/home/xw/workspace/dev)
Step 4/6: 部署 Forja...  ✓ (0.7.54-dev)
Step 5/6: 远程初始化...  ✓
Step 6/6: 切换执行模式...  ✓ (remote)
```

各步骤复用的函数：

| 步骤 | 复用函数 | 来源 |
|------|---------|------|
| 本地配置 | `runInit()` 核心逻辑 | `cli/commands/init.ts` |
| 创建服务器 | `runServerAdd()` | `cli/commands/server.ts` |
| 配置远程 | `runUseRemote()` | `cli/commands/use.ts` |
| 启用同步 | `runUseSync()` | `cli/commands/use.ts` |
| 部署 forja | `executeRemoteBootstrap()` | `remote/core/bootstrap.ts` |
| 远程 init | `executeRemoteBridge()` | `remote/core/bridge.ts` |
| 切换执行 | `runUseExecution()` | `cli/commands/use.ts` |

### Phase 4: 输出摘要

```
Setup complete!
  本地:  Qt 5.15.13 + VS 2022
  远程:  wsl_dev_158_44 → /home/xw/workspace/dev
  同步:  enabled
  执行:  remote
Next:
  forja build
```

### 幂等性

重复执行 `forja setup remote` 时，已配置的步骤显示 `–`（skipped）：

```
Remote Setup
Workspace: c:\Code\workspace\dev

Remote:
  wsl_dev_158_44 (xw@172.31.158.44)
  Remote path: /home/xw/workspace/dev
  Sync: enabled
  Forja: 0.7.54-dev

  – Server
  – Remote config
  – Sync
  – Deploy Forja
  – Remote init
  – Execution switch

Next:
  forja build
```

### setup 自动推断的配置

| 配置项 | 推断规则 |
|--------|---------|
| 远程路径 | `/home/<username>/<workspace-basename>` |
| repo 映射 | 扫描本地 git repos，按目录名自动映射 |
| forja-bin | 固定 `$HOME/.forja/bin/forja` |
| build-order | 按检测到的 target 自动生成 |
| sync | 默认启用，使用同一服务器和路径 |

---

## 删除的命令/函数

### 删除的
| 旧命令 | 替代方案 |
|--------|---------|
| `forja init` | `forja setup` |
| `list remote-repos` | 合并到 `list remote` |

### 简化的（去掉 set/clear，保留核心）
| 旧命令（3 层） | 新命令（2 层） |
|---------------|--------------|
| `use remote workspace set --path /x --mode staged` | `use remote workspace --path /x --mode staged` |
| `use remote workspace clear` | `use remote workspace --clear` |
| `use remote repo set --local x --remote y --role z` | `use remote repo --local x --remote y --role z` |
| `use remote repo remove --local x` | `use remote repo --remove --local x` |
| `use remote repo clear` | `use remote repo --clear` |
| `use remote forja-bin set --path /x` | 删除（固定路径 `$HOME/.forja/bin/forja`） |
| `use remote forja-bin clear` | 删除 |
| `use remote build-order set qt:build sdk:build` | `use remote build-order qt:build sdk:build` |
| `use remote build-order clear` | `use remote build-order --clear` |
| `use remote transfer set --server x --path y` | `use remote transfer --server x --path y` |
| `use remote transfer clear` | `use remote transfer --clear` |

### 删除的函数
无。现有函数保留，只简化参数处理（去掉 set/clear 分支逻辑）。

---

## 文件改动

| 文件 | 改动 |
|------|------|
| `src/cli/commands/setup.ts` | **新建** — `runSetup()` 核心逻辑 |
| `src/cli/commands/index.ts` | 注册 setup，简化 use remote（去 set/clear），合并 list remote |
| `src/cli/commands/use.ts` | 简化 runUseRemoteXxx 函数（去 set/clear 分支） |
| `src/cli/commands/init.ts` | 保留 `runInit()` 导出供 setup 调用 |
| `src/cli/commands/list.ts` | 合并 remote + remote-repos |
| `src/vscode/commands.ts` | `forja.init` → `forja.setup` |
| `src/extension.ts` | 命令注册更新 |
| `package.json` | 命令 ID 更新 |

---

## 验证

1. `forja setup` 完成本地配置（扫描、检测、自动选择）
2. `forja setup remote` 完成远程配置（服务器、同步、部署、init、切换执行模式）
3. `forja setup` 重复执行幂等（跳过已配置步骤）
4. `forja setup remote` 重复执行幂等（已配置步骤显示 skipped）
5. `forja use remote --server <id>` 切换服务器
6. `forja use remote --remote-path <path>` 改远程路径
7. `forja use remote workspace --path /xxx --mode staged` 改 workspace
8. `forja use remote build-order qt:build sdk:build` 改构建顺序
9. `forja use remote transfer --server <id> --path <path>` 改部署目标
10. `forja use remote workspace` 无参数显示当前值
11. `forja use remote workspace --clear` 清除配置
12. `forja list remote` 显示完整远程配置（含 repo 映射）
13. `forja build` 远程构建成功
14. VSCode `Forja: Setup` 命令可用
15. 旧的 3 层嵌套命令（set/clear）不再可用
